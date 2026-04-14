package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

const DefaultChatModel = "gpt-4o-mini"
const chatSearchReferencesMarker = "[WEB_SEARCH_REFERENCES]"
const maxAIAttachmentBytes int64 = 10 * 1024 * 1024
const maxAITextFileBytes int64 = 1 * 1024 * 1024
const (
	chatTimeoutBase = 60 * time.Second
	chatTimeoutMax  = 180 * time.Second
)

type ChatService interface {
	CreateConversation(ctx context.Context, userID int64, title, modelName, systemPrompt string) (model.ChatConversationDTO, *model.APIError)
	ListConversations(ctx context.Context, userID int64) ([]model.ChatConversationDTO, *model.APIError)
	ListMessages(ctx context.Context, userID, conversationID int64, limit int) ([]model.ChatMessageDTO, *model.APIError)
	SendMessage(ctx context.Context, userID, conversationID int64, content string, enableWebSearch bool, attachments []model.ChatAttachmentRef, maxContextMessages int, subjectID int64, projectID int64) (model.ChatSendResultDTO, *model.APIError)
	DeleteConversation(ctx context.Context, userID, conversationID int64) (bool, *model.APIError)
}

type chatService struct {
	repository          repository.ChatRepository
	systemConfigService SystemConfigService
	userConfigService   UserConfigService
	fileService         FileService
	webSearchClient     WebSearchClient
	aiClient            ai.ChatCompletionClient
	knowledgeService    KnowledgeService
}

func NewChatService(
	repository repository.ChatRepository,
	systemConfigService SystemConfigService,
	userConfigService UserConfigService,
	fileService FileService,
	webSearchClient WebSearchClient,
	aiClient ai.ChatCompletionClient,
	knowledgeService KnowledgeService,
) ChatService {
	if webSearchClient == nil {
		webSearchClient = NewTavilySearchClient(nil)
	}
	return &chatService{
		repository:          repository,
		systemConfigService: systemConfigService,
		userConfigService:   userConfigService,
		fileService:         fileService,
		webSearchClient:     webSearchClient,
		aiClient:            aiClient,
		knowledgeService:    knowledgeService,
	}
}

func (service *chatService) CreateConversation(_ context.Context, userID int64, title, modelName, systemPrompt string) (model.ChatConversationDTO, *model.APIError) {
	if userID <= 0 {
		return model.ChatConversationDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	title = strings.TrimSpace(title)
	systemPrompt = strings.TrimSpace(systemPrompt)
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = DefaultChatModel
	}

	created := service.repository.CreateConversation(model.ChatConversation{
		BaseEntity: model.BaseEntity{
			CreatedBy: userID,
			UpdatedBy: userID,
		},
		UserID:          userID,
		Title:           title,
		Model:           modelName,
		SystemPrompt:    systemPrompt,
		EnableWebSearch: false,
	})
	if created.ID <= 0 {
		return model.ChatConversationDTO{}, model.NewAPIError(500, response.CodeInternal, "创建会话失败")
	}
	return created, nil
}

func (service *chatService) ListConversations(_ context.Context, userID int64) ([]model.ChatConversationDTO, *model.APIError) {
	if userID <= 0 {
		return nil, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	return service.repository.ListConversationsByUser(userID), nil
}

func (service *chatService) ListMessages(_ context.Context, userID, conversationID int64, limit int) ([]model.ChatMessageDTO, *model.APIError) {
	if userID <= 0 {
		return nil, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	if conversationID <= 0 {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "会话 id 不合法")
	}
	if _, ok := service.repository.FindConversationByIDForUser(conversationID, userID); !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "会话不存在")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	return service.repository.ListRecentMessages(conversationID, limit), nil
}

func (service *chatService) SendMessage(ctx context.Context, userID, conversationID int64, content string, enableWebSearch bool, attachments []model.ChatAttachmentRef, maxContextMessages int, subjectID int64, projectID int64) (model.ChatSendResultDTO, *model.APIError) {
	if userID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	if conversationID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "会话 id 不合法")
	}
	content = strings.TrimSpace(content)
	if content == "" && len(attachments) == 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "content 与 attachments 不能同时为空")
	}
	if len(attachments) > 5 {
		return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "attachments 最多支持 5 个")
	}

	conversation, ok := service.repository.FindConversationByIDForUser(conversationID, userID)
	if !ok {
		return model.ChatSendResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "会话不存在")
	}

	config, apiError := service.userConfigService.GetByUserID(ctx, userID)
	if apiError != nil {
		return model.ChatSendResultDTO{}, apiError
	}
	baseURL := strings.TrimSpace(config.AIBaseURL)
	apiKey := strings.TrimSpace(config.AIApiKey)
	if baseURL == "" || apiKey == "" {
		return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "缺少用户配置：AI 服务商地址、AI APIKey")
	}

	if maxContextMessages <= 0 {
		maxContextMessages = 20
	}
	if maxContextMessages > 100 {
		maxContextMessages = 100
	}

	attachmentContent := make([]ai.ChatMessageContentPart, 0)
	attachmentContext := ""
	totalAttachmentBytes := int64(0)
	attachmentContext, apiError = service.buildKnowledgeAttachmentContext(ctx, userID, content, attachments, subjectID, projectID)
	if apiError != nil {
		return model.ChatSendResultDTO{}, apiError
	}
	if strings.TrimSpace(attachmentContext) == "" {
		fallbackContent, fallbackContext, fallbackBytes, fallbackError := service.buildAttachmentPayload(ctx, attachments)
		if fallbackError != nil {
			return model.ChatSendResultDTO{}, fallbackError
		}
		attachmentContent = fallbackContent
		attachmentContext = fallbackContext
		totalAttachmentBytes = fallbackBytes
	}
	webSearchContext := ""
	searchResults := make([]WebSearchResult, 0)
	if enableWebSearch {
		searchConfig, searchAPIError := service.systemConfigService.Get(ctx)
		if searchAPIError != nil {
			return model.ChatSendResultDTO{}, searchAPIError
		}
		if strings.TrimSpace(content) == "" {
			return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "开启联网搜索时，content 不能为空")
		}
		searchService := strings.TrimSpace(searchConfig.SearchService)
		if searchService == "" {
			searchService = DefaultSearchService
		}
		if searchService != DefaultSearchService {
			return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "当前仅支持 Tavily 搜索服务")
		}
		searchAPIKey := strings.TrimSpace(config.SearchServiceAPIKey)
		if searchAPIKey == "" {
			return model.ChatSendResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "缺少用户配置：搜索服务 APIKey")
		}
		searchBaseURL := strings.TrimSpace(config.SearchServiceBaseURL)
		results, searchErr := service.webSearchClient.Search(ctx, WebSearchRequest{
			Service: searchService,
			BaseURL: searchBaseURL,
			APIKey:  searchAPIKey,
			Query:   content,
		})
		if searchErr != nil {
			return model.ChatSendResultDTO{}, model.NewAPIError(502, response.CodeInternal, "搜索服务调用失败："+searchErr.Error())
		}
		searchResults = results
		webSearchContext = formatWebSearchContext(results)
	}
	storedContent := content
	if storedContent == "" && strings.TrimSpace(attachmentContext) != "" {
		storedContent = "[用户上传了附件]"
	}

	userMessage := service.repository.CreateMessage(model.ChatMessage{
		ConversationID: conversationID,
		Role:           model.ChatMessageRoleUser,
		Content:        storedContent,
	})
	if userMessage.ID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(500, response.CodeInternal, "写入消息失败")
	}

	history := service.repository.ListRecentMessages(conversationID, maxContextMessages)
	messages := make([]ai.ChatMessage, 0, len(history)+1)
	if strings.TrimSpace(conversation.SystemPrompt) != "" {
		messages = append(messages, ai.ChatMessage{Role: model.ChatMessageRoleSystem, Content: conversation.SystemPrompt})
	}
	for _, item := range history {
		var messageContent any = item.Content
		if item.ID == userMessage.ID {
			userText := strings.TrimSpace(item.Content)
			if userText == "" {
				userText = "请结合附件内容回答。"
			}
			userPrompt := buildChatUserPrompt(webSearchContext, attachmentContext, userText)
			if len(attachmentContent) > 0 {
				parts := make([]ai.ChatMessageContentPart, 0, len(attachmentContent)+1)
				parts = append(parts, ai.ChatMessageContentPart{
					Type: "text",
					Text: userPrompt,
				})
				parts = append(parts, attachmentContent...)
				messageContent = parts
			} else if strings.TrimSpace(webSearchContext) != "" {
				messageContent = userPrompt
			}
		}
		messages = append(messages, ai.ChatMessage{Role: item.Role, Content: messageContent})
	}

	temperature := 0.2
	aiTimeout := resolveChatTimeout(totalAttachmentBytes, len(attachments))
	aiRequest := ai.ChatCompletionRequest{
		BaseURL:     baseURL,
		APIKey:      apiKey,
		Model:       conversation.Model,
		Messages:    messages,
		Temperature: temperature,
		Timeout:     aiTimeout,
	}
	assistantText, err := service.aiClient.CreateChatCompletion(ctx, aiRequest)
	if err != nil {
		if ai.IsTimeoutError(err) {
			return model.ChatSendResultDTO{}, model.NewAPIError(504, response.CodeInternal, "AI 请求超时，请稍后重试")
		}
		return model.ChatSendResultDTO{}, model.NewAPIError(502, response.CodeInternal, "AI 调用失败："+err.Error())
	}
	if enableWebSearch && len(searchResults) > 0 {
		assistantText = appendSearchReferencesMetadata(assistantText, searchResults)
	}

	assistantMessage := service.repository.CreateMessage(model.ChatMessage{
		ConversationID: conversationID,
		Role:           model.ChatMessageRoleAssistant,
		Content:        assistantText,
	})
	if assistantMessage.ID <= 0 {
		return model.ChatSendResultDTO{}, model.NewAPIError(500, response.CodeInternal, "写入回复失败")
	}

	touched, ok := service.repository.TouchConversation(conversationID, userID)
	if !ok {
		touched = conversation.ToDTO()
	}

	return model.ChatSendResultDTO{
		Conversation:     touched,
		UserMessage:      userMessage,
		AssistantMessage: assistantMessage,
	}, nil
}

func (service *chatService) buildKnowledgeAttachmentContext(ctx context.Context, userID int64, content string, attachments []model.ChatAttachmentRef, subjectID int64, projectID int64) (string, *model.APIError) {
	if service.knowledgeService == nil {
		return "", nil
	}
	query := strings.TrimSpace(content)
	if query == "" {
		query = "请总结附件核心内容"
	}
	result, apiError := service.knowledgeService.Search(ctx, userID, KnowledgeSearchRequest{
		Query:     query,
		TopK:      12,
		MinScore:  0.2,
		FileIDs:   uniqueAttachmentFileIDs(attachments),
		SubjectID: subjectID,
		ProjectID: projectID,
	})
	if apiError != nil {
		if strings.Contains(strings.TrimSpace(apiError.Message), "本地向量配置缺失") {
			return "", apiError
		}
		log.Printf("knowledge-search failed userId=%d err=%s", userID, apiError.Message)
		return "", nil
	}
	if len(result.Hits) == 0 {
		return "", nil
	}
	lines := make([]string, 0, len(result.Hits)+1)
	lines = append(lines, "附件知识检索命中（请优先基于以下证据回答，并在结论中引用 sourceRef）：")
	for index, hit := range result.Hits {
		lines = append(lines, fmt.Sprintf(
			"%d) score=%.4f sourceRef=%s page=%d-%d 摘要=%s 片段=%s",
			index+1,
			hit.Score,
			strings.TrimSpace(hit.SourceRef),
			hit.PageStart,
			hit.PageEnd,
			strings.TrimSpace(hit.ChunkSummary),
			strings.TrimSpace(hit.ChunkText),
		))
	}
	return strings.Join(lines, "\n"), nil
}

func uniqueAttachmentFileIDs(attachments []model.ChatAttachmentRef) []int64 {
	if len(attachments) == 0 {
		return nil
	}
	set := make(map[int64]struct{}, len(attachments))
	for _, attachment := range attachments {
		if attachment.FileID > 0 {
			set[attachment.FileID] = struct{}{}
		}
	}
	ids := make([]int64, 0, len(set))
	for fileID := range set {
		ids = append(ids, fileID)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func (service *chatService) buildAttachmentPayload(ctx context.Context, attachments []model.ChatAttachmentRef) ([]ai.ChatMessageContentPart, string, int64, *model.APIError) {
	if len(attachments) == 0 {
		return nil, "", 0, nil
	}
	lines := make([]string, 0, len(attachments)+2)
	lines = append(lines, "用户本次消息附带了以下文件，请结合这些文件信息回答：")
	parts := make([]ai.ChatMessageContentPart, 0, len(attachments))
	var totalBytes int64
	for index, attachment := range attachments {
		if attachment.FileID <= 0 {
			return nil, "", 0, model.NewAPIError(400, response.CodeBadRequest, "attachments.fileId 不合法")
		}
		version, raw, apiError := service.fileService.ReadReferenceContent(ctx, attachment.FileID, attachment.VersionNo, maxAIAttachmentBytes)
		if apiError != nil {
			return nil, "", 0, apiError
		}
		totalBytes += int64(len(raw))
		lines = append(lines, fmt.Sprintf("%d. fileId=%d, versionNo=%d, name=%s, mime=%s, sizeBytes=%d, storageKey=%s",
			index+1,
			version.FileID,
			version.VersionNo,
			version.OriginName,
			version.MimeType,
			version.SizeBytes,
			version.StorageKey,
		))
		if strings.HasPrefix(strings.ToLower(version.MimeType), "image/") {
			encoded := base64.StdEncoding.EncodeToString(raw)
			parts = append(parts, ai.ChatMessageContentPart{
				Type: "image_url",
				ImageURL: &ai.ChatMessageImageURL{
					URL: "data:" + version.MimeType + ";base64," + encoded,
				},
			})
			continue
		}
		if isTextLikeMime(version.MimeType) {
			if int64(len(raw)) > maxAITextFileBytes {
				raw = raw[:maxAITextFileBytes]
			}
			text := string(raw)
			if !utf8.ValidString(text) {
				continue
			}
			parts = append(parts, ai.ChatMessageContentPart{
				Type: "text",
				Text: fmt.Sprintf("附件 %s 的内容如下：\n%s", version.OriginName, text),
			})
			continue
		}
		snippet := raw
		if len(snippet) > 128*1024 {
			snippet = snippet[:128*1024]
		}
		parts = append(parts, ai.ChatMessageContentPart{
			Type: "text",
			Text: fmt.Sprintf("附件 %s 为非文本文件，以下是 base64 片段（可能被截断）：\n%s", version.OriginName, base64.StdEncoding.EncodeToString(snippet)),
		})
	}
	return parts, strings.Join(lines, "\n"), totalBytes, nil
}

func buildChatUserPrompt(webSearchContext, attachmentContext, userText string) string {
	segments := make([]string, 0, 3)
	if strings.TrimSpace(webSearchContext) != "" {
		segments = append(segments, "联网搜索结果（仅供参考）：\n"+webSearchContext)
	}
	if strings.TrimSpace(attachmentContext) != "" {
		segments = append(segments, attachmentContext)
	}
	segments = append(segments, "用户消息：\n"+strings.TrimSpace(userText))
	return strings.Join(segments, "\n\n")
}

func isTextLikeMime(mimeType string) bool {
	value := strings.ToLower(strings.TrimSpace(mimeType))
	if strings.HasPrefix(value, "text/") {
		return true
	}
	switch value {
	case "application/json", "application/xml", "application/yaml", "application/x-yaml":
		return true
	default:
		return false
	}
}

func resolveChatTimeout(totalAttachmentBytes int64, attachmentCount int) time.Duration {
	if attachmentCount <= 0 || totalAttachmentBytes <= 0 {
		return chatTimeoutBase
	}
	switch {
	case totalAttachmentBytes <= 1*1024*1024:
		return 90 * time.Second
	case totalAttachmentBytes <= 10*1024*1024:
		return 120 * time.Second
	case totalAttachmentBytes <= 25*1024*1024:
		return 150 * time.Second
	default:
		return chatTimeoutMax
	}
}

func appendSearchReferencesMetadata(content string, results []WebSearchResult) string {
	if len(results) == 0 {
		return content
	}
	type reference struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	}
	refs := make([]reference, 0, len(results))
	maxCount := len(results)
	if maxCount > 8 {
		maxCount = 8
	}
	for i := 0; i < maxCount; i++ {
		title := strings.TrimSpace(results[i].Title)
		url := strings.TrimSpace(results[i].URL)
		if title == "" && url == "" {
			continue
		}
		refs = append(refs, reference{
			Title: title,
			URL:   url,
		})
	}
	if len(refs) == 0 {
		return content
	}
	raw, err := json.Marshal(refs)
	if err != nil {
		return content
	}
	base := strings.TrimSpace(content)
	if base == "" {
		base = "已基于联网信息生成回答。"
	}
	return base + "\n\n" + chatSearchReferencesMarker + string(raw)
}

func (service *chatService) DeleteConversation(_ context.Context, userID, conversationID int64) (bool, *model.APIError) {
	if userID <= 0 {
		return false, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	if conversationID <= 0 {
		return false, model.NewAPIError(400, response.CodeBadRequest, "会话 id 不合法")
	}
	if _, ok := service.repository.FindConversationByIDForUser(conversationID, userID); !ok {
		return false, model.NewAPIError(404, response.CodeNotFound, "会话不存在")
	}
	if !service.repository.DeleteConversation(conversationID) {
		return false, model.NewAPIError(500, response.CodeInternal, "删除会话失败")
	}
	return true, nil
}
