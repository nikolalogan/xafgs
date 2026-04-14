package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

const (
	knowledgeChunkMaxLen  = 800
	knowledgeChunkMinLen  = 500
	knowledgeChunkOverlap = 80
	knowledgeTableWindow  = 20
)

type KnowledgeSearchRequest struct {
	Query     string
	TopK      int
	MinScore  float64
	FileIDs   []int64
	BizKey    string
	SubjectID int64
	ProjectID int64
}

type KnowledgeService interface {
	Enqueue(ctx context.Context, fileID int64, versionNo int) *model.APIError
	Reindex(ctx context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError)
	GetStatus(ctx context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError)
	Search(ctx context.Context, userID int64, request KnowledgeSearchRequest) (model.KnowledgeSearchResultDTO, *model.APIError)
	RunOnce(ctx context.Context) bool
	StartWorker(ctx context.Context, interval time.Duration)
}

type knowledgeService struct {
	repository           repository.KnowledgeRepository
	fileRepository       repository.FileRepository
	fileService          FileService
	systemConfigService  SystemConfigService
	documentParseService DocumentParseService
	embeddingClient      ai.EmbeddingClient
	enabled              bool
}

func NewKnowledgeService(
	repository repository.KnowledgeRepository,
	fileRepository repository.FileRepository,
	fileService FileService,
	systemConfigService SystemConfigService,
	documentParseService DocumentParseService,
	embeddingClient ai.EmbeddingClient,
) KnowledgeService {
	return &knowledgeService{
		repository:           repository,
		fileRepository:       fileRepository,
		fileService:          fileService,
		systemConfigService:  systemConfigService,
		documentParseService: documentParseService,
		embeddingClient:      embeddingClient,
		enabled:              repository != nil && embeddingClient != nil,
	}
}

func (service *knowledgeService) Enqueue(_ context.Context, fileID int64, versionNo int) *model.APIError {
	if !service.enabled {
		return model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	if fileID <= 0 || versionNo <= 0 {
		return model.NewAPIError(400, response.CodeBadRequest, "fileId/versionNo 不合法")
	}
	if _, ok := service.repository.EnqueueJob(fileID, versionNo); !ok {
		return model.NewAPIError(500, response.CodeInternal, "索引任务入队失败")
	}
	return nil
}

func (service *knowledgeService) Reindex(ctx context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError) {
	if !service.enabled {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	if fileID <= 0 {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId 不合法")
	}
	resolvedVersion, apiError := service.fileService.ResolveReference(ctx, fileID, versionNo)
	if apiError != nil {
		return model.KnowledgeIndexStatusDTO{}, apiError
	}
	if enqueueError := service.Enqueue(ctx, fileID, resolvedVersion.VersionNo); enqueueError != nil {
		return model.KnowledgeIndexStatusDTO{}, enqueueError
	}
	return service.GetStatus(ctx, fileID, resolvedVersion.VersionNo)
}

func (service *knowledgeService) GetStatus(_ context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError) {
	if !service.enabled {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	if fileID <= 0 {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId 不合法")
	}
	job, ok := service.repository.FindLatestJob(fileID, versionNo)
	if !ok {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(404, response.CodeNotFound, "索引任务不存在")
	}
	return model.KnowledgeIndexStatusDTO{
		FileID:       job.FileID,
		VersionNo:    job.VersionNo,
		Status:       job.Status,
		RetryCount:   job.RetryCount,
		ErrorMessage: job.ErrorMessage,
		StartedAt:    job.StartedAt,
		FinishedAt:   job.FinishedAt,
		UpdatedAt:    job.UpdatedAt,
	}, nil
}

func (service *knowledgeService) Search(ctx context.Context, _ int64, request KnowledgeSearchRequest) (model.KnowledgeSearchResultDTO, *model.APIError) {
	if !service.enabled {
		return model.KnowledgeSearchResultDTO{}, model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	query := strings.TrimSpace(request.Query)
	if query == "" {
		return model.KnowledgeSearchResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "query 不能为空")
	}
	embeddingConfig, apiError := service.getEmbeddingConfig(ctx)
	if apiError != nil {
		return model.KnowledgeSearchResultDTO{}, apiError
	}
	vector, embeddingError := service.embedSingle(ctx, embeddingConfig, query)
	if embeddingError != nil {
		return model.KnowledgeSearchResultDTO{}, model.NewAPIError(502, response.CodeInternal, "向量化失败："+embeddingError.Error())
	}
	hits := service.repository.Search(embeddingConfig.Model, query, vector, repository.KnowledgeSearchFilter{
		FileIDs:        request.FileIDs,
		BizKey:         strings.TrimSpace(request.BizKey),
		BizKeyPrefixes: buildScopeBizKeyPrefixes(request.SubjectID, request.ProjectID),
		TopK:           request.TopK,
		MinScore:       request.MinScore,
	})
	return model.KnowledgeSearchResultDTO{Hits: hits}, nil
}

func (service *knowledgeService) RunOnce(ctx context.Context) bool {
	if !service.enabled {
		return false
	}
	job, ok := service.repository.ClaimNextJob(3)
	if !ok {
		return false
	}
	if err := service.runJob(ctx, job); err != nil {
		_ = service.repository.MarkJobFailed(job.ID, err.Error())
		log.Printf("knowledge-index failed fileId=%d versionNo=%d err=%v", job.FileID, job.VersionNo, err)
		return true
	}
	_ = service.repository.MarkJobSucceeded(job.ID)
	return true
}

func (service *knowledgeService) StartWorker(ctx context.Context, interval time.Duration) {
	if !service.enabled {
		return
	}
	if interval <= 0 {
		interval = 3 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for service.RunOnce(ctx) {
				}
			}
		}
	}()
}

func (service *knowledgeService) runJob(ctx context.Context, job model.KnowledgeIndexJob) error {
	fileEntity, ok := service.fileRepository.FindFileByID(job.FileID)
	if !ok {
		return fmt.Errorf("file 不存在")
	}
	if fileEntity.CreatedBy <= 0 {
		return fmt.Errorf("file 创建人不存在")
	}
	embeddingConfig, apiError := service.getEmbeddingConfig(ctx)
	if apiError != nil {
		return fmt.Errorf("%s", apiError.Message)
	}
	parsed, parseError := service.documentParseService.ParseCaseFile(ctx, model.ReportCaseFile{
		FileID:    job.FileID,
		VersionNo: job.VersionNo,
	})
	if parseError != nil {
		return fmt.Errorf("文档解析失败: %s", parseError.Message)
	}
	chunks := buildKnowledgeChunks(parsed, fileEntity.BizKey)
	if len(chunks) == 0 {
		return fmt.Errorf("未提取到有效文本分块")
	}
	inputs := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		inputs = append(inputs, chunk.ChunkText)
	}
	embeddings, embedError := service.embeddingClient.CreateEmbeddings(ctx, ai.EmbeddingRequest{
		BaseURL: embeddingConfig.BaseURL,
		APIKey:  embeddingConfig.APIKey,
		Model:   embeddingConfig.Model,
		Input:   inputs,
		Timeout: 90 * time.Second,
	})
	if embedError != nil {
		return fmt.Errorf("向量化失败: %w", embedError)
	}
	if len(embeddings) != len(chunks) {
		return fmt.Errorf("embedding 数量不匹配")
	}
	for index := range chunks {
		if len(embeddings[index]) != embeddingConfig.Dimension {
			return fmt.Errorf("embedding 维度非法: %d", len(embeddings[index]))
		}
		chunks[index].Embedding = embeddings[index]
	}
	if ok := service.repository.ReplaceChunks(job.FileID, job.VersionNo, embeddingConfig.Model, chunks); !ok {
		return fmt.Errorf("落库失败")
	}
	return nil
}

func (service *knowledgeService) embedSingle(ctx context.Context, config embeddingRuntimeConfig, input string) ([]float64, error) {
	results, err := service.embeddingClient.CreateEmbeddings(ctx, ai.EmbeddingRequest{
		BaseURL: config.BaseURL,
		APIKey:  config.APIKey,
		Model:   config.Model,
		Input:   []string{input},
		Timeout: 45 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	if len(results) != 1 || len(results[0]) != config.Dimension {
		return nil, fmt.Errorf("embedding 返回非法")
	}
	return results[0], nil
}

type embeddingRuntimeConfig struct {
	BaseURL   string
	APIKey    string
	Model     string
	Dimension int
}

func (service *knowledgeService) getEmbeddingConfig(ctx context.Context) (embeddingRuntimeConfig, *model.APIError) {
	config, apiError := service.systemConfigService.Get(ctx)
	if apiError != nil {
		return embeddingRuntimeConfig{}, apiError
	}
	baseURL := strings.TrimSpace(config.LocalEmbeddingBaseURL)
	apiKey := strings.TrimSpace(config.LocalEmbeddingAPIKey)
	modelName := strings.TrimSpace(config.LocalEmbeddingModel)
	dimension := config.LocalEmbeddingDimension
	if baseURL == "" || apiKey == "" || modelName == "" || dimension <= 0 {
		return embeddingRuntimeConfig{}, model.NewAPIError(400, response.CodeBadRequest, "本地向量配置缺失，请联系管理员在系统设置中补充")
	}
	return embeddingRuntimeConfig{
		BaseURL:   baseURL,
		APIKey:    apiKey,
		Model:     modelName,
		Dimension: dimension,
	}, nil
}

func buildKnowledgeChunks(parsed ParsedDocument, bizKey string) []model.KnowledgeChunk {
	sections := make([]model.KnowledgeChunk, 0)
	index := 0
	for _, slice := range parsed.Slices {
		if strings.TrimSpace(slice.CleanText) == "" {
			continue
		}
		if slice.SliceType != model.DocumentStructureParagraph && slice.SliceType != model.DocumentStructureSection && slice.SliceType != model.DocumentStructurePage {
			continue
		}
		parts := splitTextWithOverlap(strings.TrimSpace(slice.CleanText), knowledgeChunkMaxLen, knowledgeChunkOverlap)
		for _, part := range parts {
			partText := strings.TrimSpace(part)
			if partText == "" {
				continue
			}
			sections = append(sections, model.KnowledgeChunk{
				FileID:        parsed.Version.FileID,
				VersionNo:     parsed.Version.VersionNo,
				BizKey:        strings.TrimSpace(bizKey),
				ChunkIndex:    index,
				ChunkText:     partText,
				ChunkSummary:  summarizeChunk(partText, 80),
				SourceType:    slice.SourceType,
				PageStart:     slice.PageStart,
				PageEnd:       slice.PageEnd,
				SourceRef:     buildSourceRef(parsed.Version.FileID, slice.PageStart, slice.PageEnd, index),
				BBoxJSON:      slice.BBoxJSON,
				ParseStrategy: parsed.Profile.ParseStrategy,
				ContentHash:   hashContent(partText),
			})
			index++
		}
	}

	tableChunks := buildTableChunks(parsed, strings.TrimSpace(bizKey), index)
	sections = append(sections, tableChunks...)
	sort.Slice(sections, func(i, j int) bool {
		return sections[i].ChunkIndex < sections[j].ChunkIndex
	})
	return sections
}

func buildTableChunks(parsed ParsedDocument, bizKey string, startIndex int) []model.KnowledgeChunk {
	if len(parsed.Tables) == 0 || len(parsed.TableCells) == 0 {
		return nil
	}
	cellMap := map[int64][]model.DocumentTableCell{}
	for _, cell := range parsed.TableCells {
		cellMap[cell.TableID] = append(cellMap[cell.TableID], cell)
	}
	out := make([]model.KnowledgeChunk, 0)
	chunkIndex := startIndex
	for _, table := range parsed.Tables {
		cells := cellMap[table.ID]
		if len(cells) == 0 {
			continue
		}
		sort.Slice(cells, func(i, j int) bool {
			if cells[i].RowIndex != cells[j].RowIndex {
				return cells[i].RowIndex < cells[j].RowIndex
			}
			return cells[i].ColIndex < cells[j].ColIndex
		})
		rows := map[int][]string{}
		rowOrder := make([]int, 0)
		for _, cell := range cells {
			value := strings.TrimSpace(cell.NormalizedValue)
			if value == "" {
				value = strings.TrimSpace(cell.RawText)
			}
			if _, exists := rows[cell.RowIndex]; !exists {
				rowOrder = append(rowOrder, cell.RowIndex)
			}
			rows[cell.RowIndex] = append(rows[cell.RowIndex], value)
		}
		sort.Ints(rowOrder)
		window := make([]string, 0, knowledgeTableWindow)
		for index, rowIndex := range rowOrder {
			rowText := strings.Join(rows[rowIndex], " | ")
			window = append(window, fmt.Sprintf("R%d: %s", rowIndex+1, strings.TrimSpace(rowText)))
			if len(window) >= knowledgeTableWindow || index == len(rowOrder)-1 {
				content := strings.TrimSpace(fmt.Sprintf("表格：%s\n%s", strings.TrimSpace(table.Title), strings.Join(window, "\n")))
				if content != "" {
					out = append(out, model.KnowledgeChunk{
						FileID:        parsed.Version.FileID,
						VersionNo:     parsed.Version.VersionNo,
						BizKey:        bizKey,
						ChunkIndex:    chunkIndex,
						ChunkText:     content,
						ChunkSummary:  summarizeChunk(content, 80),
						SourceType:    table.SourceType,
						PageStart:     table.PageStart,
						PageEnd:       table.PageEnd,
						SourceRef:     buildSourceRef(parsed.Version.FileID, table.PageStart, table.PageEnd, chunkIndex),
						BBoxJSON:      table.BBoxJSON,
						ParseStrategy: parsed.Profile.ParseStrategy,
						ContentHash:   hashContent(content),
					})
					chunkIndex++
				}
				window = make([]string, 0, knowledgeTableWindow)
			}
		}
	}
	return out
}

func splitTextWithOverlap(text string, maxLen int, overlap int) []string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= knowledgeChunkMinLen {
		return []string{string(runes)}
	}
	if maxLen <= 0 {
		maxLen = knowledgeChunkMaxLen
	}
	if overlap < 0 {
		overlap = 0
	}
	out := make([]string, 0)
	start := 0
	for start < len(runes) {
		end := start + maxLen
		if end > len(runes) {
			end = len(runes)
		}
		segment := strings.TrimSpace(string(runes[start:end]))
		if segment != "" {
			out = append(out, segment)
		}
		if end == len(runes) {
			break
		}
		nextStart := end - overlap
		if nextStart <= start {
			nextStart = end
		}
		start = nextStart
	}
	return out
}

func summarizeChunk(text string, maxLen int) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	parts := strings.Fields(trimmed)
	compact := strings.Join(parts, " ")
	runes := []rune(compact)
	if len(runes) <= maxLen {
		return compact
	}
	return string(runes[:maxLen]) + "…"
}

func buildSourceRef(fileID int64, pageStart int, pageEnd int, chunkIndex int) string {
	if pageStart <= 0 {
		pageStart = 1
	}
	if pageEnd < pageStart {
		pageEnd = pageStart
	}
	return fmt.Sprintf("f%d#p%d-%d#k%d", fileID, pageStart, pageEnd, chunkIndex)
}

func hashContent(content string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(content)))
	return hex.EncodeToString(sum[:])
}

func buildScopeBizKeyPrefixes(subjectID int64, projectID int64) []string {
	prefixes := make([]string, 0, 2)
	if subjectID > 0 {
		prefixes = append(prefixes, fmt.Sprintf("subject:%d", subjectID))
	}
	if projectID > 0 {
		prefixes = append(prefixes, fmt.Sprintf("project:%d", projectID))
	}
	return prefixes
}
