package service

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"mime/multipart"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type ReportingService interface {
	ListReportTemplates(ctx context.Context, operatorID int64, operatorRole string) ([]model.ReportTemplateDTO, *model.APIError)
	GetReportTemplate(ctx context.Context, templateID int64, operatorID int64, operatorRole string) (model.ReportTemplateDetailDTO, *model.APIError)
	CreateReportTemplate(ctx context.Context, request model.CreateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError)
	UpdateReportTemplate(ctx context.Context, templateID int64, request model.UpdateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError)
	ImportReportTemplateWord(ctx context.Context, filename string, raw []byte) (model.ReportTemplateWordImportResult, *model.APIError)
	ImportReportTemplateWordForTemplate(ctx context.Context, templateID int64, filename string, raw []byte, operatorID int64) (model.ReportTemplateDetailDTO, *model.APIError)
	ExportReportTemplateWord(ctx context.Context, templateID int64, operatorID int64, operatorRole string) (string, []byte, string, *model.APIError)
	ReportTemplateAIAssist(ctx context.Context, templateID int64, operatorID int64, operatorRole string, request model.ReportTemplateAIAssistRequest) (model.ReportTemplateAIAssistResponse, *model.APIError)
	ListReportTemplateSharedUsers(ctx context.Context, templateID int64, operatorRole string) ([]model.ReportTemplateSharedUserDTO, *model.APIError)
	UpdateReportTemplateSharedUsers(ctx context.Context, templateID int64, userIDs []int64, operatorID int64, operatorRole string) ([]model.ReportTemplateSharedUserDTO, *model.APIError)

	ListReportCases(ctx context.Context) ([]model.ReportCaseDTO, *model.APIError)
	GetReportCase(ctx context.Context, caseID int64) (model.ReportCaseDetailDTO, *model.APIError)
	CreateReportCase(ctx context.Context, request model.CreateReportCaseRequest, operatorID int64) (model.ReportCaseDTO, *model.APIError)
	AttachReportCaseFile(ctx context.Context, caseID int64, request model.AttachReportCaseFileRequest, operatorID int64) (model.ReportCaseFileDTO, *model.APIError)
	ProcessReportCase(ctx context.Context, caseID int64, request model.ProcessReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError)
	GetReportCaseGenerationContext(ctx context.Context, caseID int64, consume bool, operatorID int64) (model.ReportCaseGenerationContextDTO, *model.APIError)
	GetReviewQueue(ctx context.Context, caseID int64) ([]model.ReviewQueueItemDTO, *model.APIError)
	ReviewReportCase(ctx context.Context, caseID int64, request model.ReviewReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError)
	GetAssembly(ctx context.Context, caseID int64) (model.AssemblyViewDTO, *model.APIError)
	ListSubjectAssets(ctx context.Context, subjectID int64) ([]model.SubjectAssetDTO, *model.APIError)
	ListEnterpriseProjects(ctx context.Context, enterpriseID int64) ([]model.EnterpriseProjectDTO, *model.APIError)
	CreateEnterpriseProject(ctx context.Context, enterpriseID int64, request model.CreateEnterpriseProjectRequest, operatorID int64) (model.EnterpriseProjectDTO, *model.APIError)
	GetEnterpriseProject(ctx context.Context, projectID int64) (model.EnterpriseProjectDetailDTO, *model.APIError)
	UploadEnterpriseProjectFiles(ctx context.Context, projectID int64, manualCategory string, fileHeaders []*multipart.FileHeader, operatorID int64) (model.UploadEnterpriseProjectFileResultDTO, *model.APIError)
	UpdateEnterpriseProjectFileManualAdjust(ctx context.Context, projectID int64, caseFileID int64, finalSubCategory string, operatorID int64) (model.EnterpriseProjectFileManualAdjustResultDTO, *model.APIError)
	GetEnterpriseProjectFileBlocks(ctx context.Context, projectID int64, caseFileID int64) (model.EnterpriseProjectFileBlocksDTO, *model.APIError)
	UpdateEnterpriseProjectFileBlock(ctx context.Context, projectID int64, caseFileID int64, blockID int64, currentHTML string, operatorID int64) (model.EnterpriseProjectFileBlockUpdateResultDTO, *model.APIError)
	ConfirmEnterpriseProjectVectorization(ctx context.Context, projectID int64, operatorID int64) (model.EnterpriseProjectVectorConfirmResultDTO, *model.APIError)
	TerminateEnterpriseProjectFile(ctx context.Context, projectID int64, caseFileID int64, operatorID int64) (model.EnterpriseProjectFileTerminateResultDTO, *model.APIError)
	GetEnterpriseProjectProgress(ctx context.Context, projectID int64) (model.EnterpriseProjectProgressDTO, *model.APIError)
	RunParseQueueOnce(ctx context.Context) bool
	StartParseWorker(ctx context.Context, interval time.Duration)
}

type reportingService struct {
	reportingRepository     repository.ReportingRepository
	resourceShareRepository repository.ResourceShareRepository
	userRepository          repository.UserRepository
	enterpriseRepository    repository.EnterpriseRepository
	fileRepository          repository.FileRepository
	fileService             FileService
	documentParseService    DocumentParseService
	userConfigService       UserConfigService
	systemConfigService     SystemConfigService
	aiClient                ai.ChatCompletionClient
	knowledgeQueue          KnowledgeIndexQueue
}

type KnowledgeIndexQueue interface {
	Enqueue(ctx context.Context, fileID int64, versionNo int) *model.APIError
	Cancel(ctx context.Context, fileID int64, versionNo int) *model.APIError
	GetStatus(ctx context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError)
}

const (
	vectorStatusNotEnqueued = "not_enqueued"
	vectorStatusUnavailable = "unavailable"
	vectorStatusStatusError = "status_error"
	terminatedByUserMessage = "用户手动终止"
)

func NewReportingService(
	reportingRepository repository.ReportingRepository,
	resourceShareRepository repository.ResourceShareRepository,
	userRepository repository.UserRepository,
	enterpriseRepository repository.EnterpriseRepository,
	fileRepository repository.FileRepository,
	fileService FileService,
	documentParseService DocumentParseService,
	userConfigService UserConfigService,
	systemConfigService SystemConfigService,
	aiClient ai.ChatCompletionClient,
	knowledgeQueue KnowledgeIndexQueue,
) ReportingService {
	return &reportingService{
		reportingRepository:     reportingRepository,
		resourceShareRepository: resourceShareRepository,
		userRepository:          userRepository,
		enterpriseRepository:    enterpriseRepository,
		fileRepository:          fileRepository,
		fileService:             fileService,
		documentParseService:    documentParseService,
		userConfigService:       userConfigService,
		systemConfigService:     systemConfigService,
		aiClient:                aiClient,
		knowledgeQueue:          knowledgeQueue,
	}
}

func (service *reportingService) ListReportTemplates(_ context.Context, operatorID int64, operatorRole string) ([]model.ReportTemplateDTO, *model.APIError) {
	rows := service.reportingRepository.FindAllReportTemplates()
	if operatorRole == model.UserRoleAdmin {
		return rows, nil
	}
	shared := service.resourceShareRepository.FindByUser(model.ResourceTypeReportTemplate, operatorID)
	sharedIDs := map[int64]struct{}{}
	for _, item := range shared {
		sharedIDs[item.ResourceID] = struct{}{}
	}
	out := make([]model.ReportTemplateDTO, 0, len(rows))
	for _, row := range rows {
		if _, ok := sharedIDs[row.ID]; ok {
			out = append(out, row)
		}
	}
	return out, nil
}

func (service *reportingService) GetReportTemplate(_ context.Context, templateID int64, operatorID int64, operatorRole string) (model.ReportTemplateDetailDTO, *model.APIError) {
	entity, ok := service.reportingRepository.FindReportTemplateByID(templateID)
	if !ok {
		return model.ReportTemplateDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	if !service.canAccessTemplate(templateID, operatorID, operatorRole) {
		return model.ReportTemplateDetailDTO{}, model.NewAPIError(403, response.CodeForbidden, "无权访问该模板")
	}
	return entity.ToDetailDTO(), nil
}

func (service *reportingService) CreateReportTemplate(_ context.Context, request model.CreateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError) {
	request.TemplateKey = strings.TrimSpace(request.TemplateKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)
	if request.TemplateKey == "" || request.Name == "" {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateKey、name 不能为空")
	}
	if request.Status == "" {
		request.Status = model.ReportTemplateStatusActive
	}
	if !model.IsValidReportTemplateStatus(request.Status) {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}
	if _, exists := service.reportingRepository.FindReportTemplateByKey(request.TemplateKey); exists {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateKey 已存在")
	}
	categories, apiError := normalizeJSONArray(request.CategoriesJSON, "categoriesJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	config, apiError := normalizeJSONObject(request.ProcessingConfigJSON, "processingConfigJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	request.ContentMarkdown = strings.TrimSpace(request.ContentMarkdown)
	editorConfig, apiError := normalizeJSONObject(request.EditorConfigJSON, "editorConfigJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	annotations, apiError := normalizeJSONArray(request.AnnotationsJSON, "annotationsJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	if request.ContentMarkdown == "" {
		request.ContentMarkdown = "## 新章节\n\n请编辑内容。"
	}
	outline := buildOutlineJSON(request.ContentMarkdown)
	initialDocx := buildMinimalDOCX(request.Name, request.ContentMarkdown)
	uploadResult, uploadError := service.fileService.CreateFileFromContent(context.Background(), operatorID, "report-template:"+request.TemplateKey, "template.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", initialDocx)
	if uploadError != nil {
		return model.ReportTemplateDTO{}, uploadError
	}
	return service.reportingRepository.CreateReportTemplate(model.ReportTemplate{
		BaseEntity:           model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		TemplateKey:          request.TemplateKey,
		Name:                 request.Name,
		Description:          request.Description,
		Status:               request.Status,
		DocFileID:            uploadResult.FileID,
		DocVersionNo:         uploadResult.VersionNo,
		CategoriesJSON:       categories,
		ProcessingConfigJSON: config,
		ContentMarkdown:      request.ContentMarkdown,
		OutlineJSON:          outline,
		EditorConfigJSON:     editorConfig,
		AnnotationsJSON:      annotations,
	}), nil
}

func (service *reportingService) UpdateReportTemplate(_ context.Context, templateID int64, request model.UpdateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError) {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)
	if request.Name == "" {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "name 不能为空")
	}
	if request.Status == "" {
		request.Status = model.ReportTemplateStatusActive
	}
	if !model.IsValidReportTemplateStatus(request.Status) {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}
	categories, apiError := normalizeJSONArray(request.CategoriesJSON, "categoriesJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	config, apiError := normalizeJSONObject(request.ProcessingConfigJSON, "processingConfigJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	request.ContentMarkdown = strings.TrimSpace(request.ContentMarkdown)
	editorConfig, apiError := normalizeJSONObject(request.EditorConfigJSON, "editorConfigJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	annotations, apiError := normalizeJSONArray(request.AnnotationsJSON, "annotationsJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	outline := buildOutlineJSON(request.ContentMarkdown)
	existingTemplate, ok := service.reportingRepository.FindReportTemplateByID(templateID)
	if !ok {
		return model.ReportTemplateDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	docFileID := existingTemplate.DocFileID
	docVersionNo := existingTemplate.DocVersionNo
	if docFileID <= 0 {
		initialDocx := buildMinimalDOCX(request.Name, request.ContentMarkdown)
		uploadResult, uploadError := service.fileService.CreateFileFromContent(context.Background(), operatorID, "report-template:"+existingTemplate.TemplateKey, "template.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", initialDocx)
		if uploadError != nil {
			return model.ReportTemplateDTO{}, uploadError
		}
		docFileID = uploadResult.FileID
		docVersionNo = uploadResult.VersionNo
	}
	updated, ok := service.reportingRepository.UpdateReportTemplate(templateID, model.ReportTemplate{
		Name:                 request.Name,
		Description:          request.Description,
		Status:               request.Status,
		DocFileID:            docFileID,
		DocVersionNo:         docVersionNo,
		CategoriesJSON:       categories,
		ProcessingConfigJSON: config,
		ContentMarkdown:      request.ContentMarkdown,
		OutlineJSON:          outline,
		EditorConfigJSON:     editorConfig,
		AnnotationsJSON:      annotations,
		BaseEntity:           model.BaseEntity{UpdatedBy: operatorID},
	})
	if !ok {
		return model.ReportTemplateDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	return updated, nil
}

func (service *reportingService) ImportReportTemplateWord(_ context.Context, filename string, raw []byte) (model.ReportTemplateWordImportResult, *model.APIError) {
	trimmedFilename := strings.ToLower(strings.TrimSpace(filename))
	if !strings.HasSuffix(trimmedFilename, ".docx") {
		return model.ReportTemplateWordImportResult{}, model.NewAPIError(400, response.CodeBadRequest, "仅支持 .docx，.doc 请先转换为 .docx")
	}
	if len(raw) == 0 {
		return model.ReportTemplateWordImportResult{}, model.NewAPIError(400, response.CodeBadRequest, "上传文件为空")
	}

	content := buildMarkdownFromDOCX(raw)
	outline := buildReportTemplateOutline(content)
	return model.ReportTemplateWordImportResult{
		ContentMarkdown: content,
		Outline:         outline,
	}, nil
}

func (service *reportingService) ExportReportTemplateWord(_ context.Context, templateID int64, operatorID int64, operatorRole string) (string, []byte, string, *model.APIError) {
	template, ok := service.reportingRepository.FindReportTemplateByID(templateID)
	if !ok {
		return "", nil, "", model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	if !service.canAccessTemplate(templateID, operatorID, operatorRole) {
		return "", nil, "", model.NewAPIError(403, response.CodeForbidden, "无权访问该模板")
	}
	content := strings.TrimSpace(template.ContentMarkdown)
	if content == "" {
		content = "## 新章节\n\n请编辑内容。"
	}
	raw := buildMinimalDOCX(template.Name, content)
	filename := strings.TrimSpace(template.Name)
	if filename == "" {
		filename = "report-template"
	}
	return filename + ".docx", raw, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", nil
}

func (service *reportingService) ReportTemplateAIAssist(ctx context.Context, templateID int64, operatorID int64, operatorRole string, request model.ReportTemplateAIAssistRequest) (model.ReportTemplateAIAssistResponse, *model.APIError) {
	if operatorID <= 0 {
		return model.ReportTemplateAIAssistResponse{}, model.NewAPIError(401, response.CodeUnauthorized, "未找到认证用户")
	}
	template, ok := service.reportingRepository.FindReportTemplateByID(templateID)
	if !ok {
		return model.ReportTemplateAIAssistResponse{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	if !service.canAccessTemplate(templateID, operatorID, operatorRole) {
		return model.ReportTemplateAIAssistResponse{}, model.NewAPIError(403, response.CodeForbidden, "无权访问该模板")
	}
	mode := strings.TrimSpace(request.Mode)
	if mode == "" {
		mode = "rewrite"
	}
	fullMarkdown := strings.TrimSpace(request.FullMarkdown)
	if fullMarkdown == "" {
		fullMarkdown = template.ContentMarkdown
	}
	selectedText := strings.TrimSpace(request.SelectedText)
	if mode != "continue" && selectedText == "" {
		return model.ReportTemplateAIAssistResponse{}, model.NewAPIError(400, response.CodeBadRequest, "请先选中文本")
	}
	systemConfig, apiError := service.systemConfigService.Get(ctx)
	if apiError != nil {
		return model.ReportTemplateAIAssistResponse{}, apiError
	}
	modelName := strings.TrimSpace(request.Model)
	if modelName == "" {
		modelName = strings.TrimSpace(systemConfig.CodeDefaultModel)
	}
	if modelName == "" {
		modelName = strings.TrimSpace(systemConfig.DefaultModel)
	}
	if modelName == "" {
		modelName = DefaultSystemModel
	}
	userConfig, apiError := service.userConfigService.GetByUserID(ctx, operatorID)
	if apiError != nil {
		return model.ReportTemplateAIAssistResponse{}, apiError
	}
	baseURL := strings.TrimSpace(userConfig.AIBaseURL)
	apiKey := strings.TrimSpace(userConfig.AIApiKey)
	if baseURL == "" || apiKey == "" {
		return model.ReportTemplateAIAssistResponse{}, model.NewAPIError(400, response.CodeBadRequest, "缺少用户配置：AI 服务商地址、AI APIKey")
	}
	instruction := strings.TrimSpace(request.Instruction)
	if instruction == "" {
		instruction = "请输出中文结果，避免杜撰事实。"
	}
	var userPrompt strings.Builder
	userPrompt.WriteString("你正在协助编辑报告模板。请只返回最终文本，不要解释。\n")
	userPrompt.WriteString(fmt.Sprintf("模式：%s\n", mode))
	userPrompt.WriteString(fmt.Sprintf("用户指令：%s\n", instruction))
	if selectedText != "" {
		userPrompt.WriteString("选中文本如下：\n")
		userPrompt.WriteString(selectedText)
		userPrompt.WriteString("\n")
	}
	if fullMarkdown != "" {
		userPrompt.WriteString("\n全文上下文（Markdown）：\n")
		userPrompt.WriteString(fullMarkdown)
	}
	assistantText, err := service.aiClient.CreateChatCompletion(ctx, ai.ChatCompletionRequest{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Model:   modelName,
		Messages: []ai.ChatMessage{
			{Role: "system", Content: "你是中文报告写作助手。输出必须可直接用于替换文档内容，不要Markdown代码块包裹。"},
			{Role: "user", Content: userPrompt.String()},
		},
		Temperature: 0.2,
		Timeout:     60 * time.Second,
	})
	if err != nil {
		return model.ReportTemplateAIAssistResponse{}, model.NewAPIError(502, response.CodeInternal, "AI 调用失败："+err.Error())
	}
	resultText := strings.TrimSpace(assistantText)
	if resultText == "" {
		return model.ReportTemplateAIAssistResponse{}, model.NewAPIError(502, response.CodeInternal, "AI 未返回有效内容")
	}
	return model.ReportTemplateAIAssistResponse{
		ResultText: resultText,
		Model:      modelName,
	}, nil
}

func (service *reportingService) upsertTemplateDocx(template model.ReportTemplate, operatorID int64, raw []byte, originName string) *model.APIError {
	var (
		fileID    int64
		versionNo int
	)
	if template.DocFileID > 0 {
		uploadResult, uploadError := service.fileService.UploadVersionFromContent(context.Background(), operatorID, template.DocFileID, originName, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", raw)
		if uploadError != nil {
			return uploadError
		}
		fileID = uploadResult.FileID
		versionNo = uploadResult.VersionNo
	} else {
		uploadResult, uploadError := service.fileService.CreateFileFromContent(context.Background(), operatorID, "report-template:"+template.TemplateKey, originName, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", raw)
		if uploadError != nil {
			return uploadError
		}
		fileID = uploadResult.FileID
		versionNo = uploadResult.VersionNo
	}
	contentMarkdown := buildMarkdownFromDOCX(raw)
	outline := buildOutlineJSON(contentMarkdown)
	annotations := buildTemplateCommentGuidanceJSON(raw)
	_, ok := service.reportingRepository.UpdateReportTemplate(template.ID, model.ReportTemplate{
		Name:                 template.Name,
		Description:          template.Description,
		Status:               template.Status,
		DocFileID:            fileID,
		DocVersionNo:         versionNo,
		CategoriesJSON:       template.CategoriesJSON,
		ProcessingConfigJSON: template.ProcessingConfigJSON,
		ContentMarkdown:      contentMarkdown,
		OutlineJSON:          outline,
		EditorConfigJSON:     template.EditorConfigJSON,
		AnnotationsJSON:      annotations,
		BaseEntity:           model.BaseEntity{UpdatedBy: operatorID},
	})
	if !ok {
		return model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	return nil
}

func (service *reportingService) ImportReportTemplateWordForTemplate(_ context.Context, templateID int64, filename string, raw []byte, operatorID int64) (model.ReportTemplateDetailDTO, *model.APIError) {
	trimmedFilename := strings.ToLower(strings.TrimSpace(filename))
	if !strings.HasSuffix(trimmedFilename, ".docx") {
		return model.ReportTemplateDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "仅支持 .docx，.doc 请先转换为 .docx")
	}
	template, ok := service.reportingRepository.FindReportTemplateByID(templateID)
	if !ok {
		return model.ReportTemplateDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	if len(raw) == 0 {
		return model.ReportTemplateDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "上传文件为空")
	}
	uploadError := service.upsertTemplateDocx(template, operatorID, raw, filename)
	if uploadError != nil {
		return model.ReportTemplateDetailDTO{}, uploadError
	}
	updatedTemplate, ok := service.reportingRepository.FindReportTemplateByID(templateID)
	if !ok {
		return model.ReportTemplateDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	return updatedTemplate.ToDetailDTO(), nil
}

func (service *reportingService) ListReportTemplateSharedUsers(_ context.Context, templateID int64, operatorRole string) ([]model.ReportTemplateSharedUserDTO, *model.APIError) {
	if operatorRole != model.UserRoleAdmin {
		return nil, model.NewAPIError(403, response.CodeForbidden, "仅管理员可操作共享")
	}
	if _, ok := service.reportingRepository.FindReportTemplateByID(templateID); !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	return service.buildSharedUserDTOs(templateID), nil
}

func (service *reportingService) UpdateReportTemplateSharedUsers(_ context.Context, templateID int64, userIDs []int64, operatorID int64, operatorRole string) ([]model.ReportTemplateSharedUserDTO, *model.APIError) {
	if operatorRole != model.UserRoleAdmin {
		return nil, model.NewAPIError(403, response.CodeForbidden, "仅管理员可操作共享")
	}
	if _, ok := service.reportingRepository.FindReportTemplateByID(templateID); !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	normalizedUserIDs := make([]int64, 0, len(userIDs))
	unique := map[int64]struct{}{}
	for _, userID := range userIDs {
		if userID <= 0 {
			continue
		}
		if _, exists := unique[userID]; exists {
			continue
		}
		user, ok := service.userRepository.FindByID(userID)
		if !ok {
			return nil, model.NewAPIError(400, response.CodeBadRequest, "共享用户不存在")
		}
		if user.Role != model.UserRoleNormal {
			return nil, model.NewAPIError(400, response.CodeBadRequest, "仅支持共享给普通用户")
		}
		unique[userID] = struct{}{}
		normalizedUserIDs = append(normalizedUserIDs, userID)
	}
	service.resourceShareRepository.ReplaceResourceShares(model.ResourceTypeReportTemplate, templateID, normalizedUserIDs, operatorID)
	return service.buildSharedUserDTOs(templateID), nil
}

func (service *reportingService) canAccessTemplate(templateID int64, operatorID int64, operatorRole string) bool {
	if operatorRole == model.UserRoleAdmin {
		return true
	}
	if operatorID <= 0 {
		return false
	}
	return service.resourceShareRepository.HasResourceAccess(model.ResourceTypeReportTemplate, templateID, operatorID)
}

func (service *reportingService) buildSharedUserDTOs(templateID int64) []model.ReportTemplateSharedUserDTO {
	shares := service.resourceShareRepository.FindByResource(model.ResourceTypeReportTemplate, templateID)
	out := make([]model.ReportTemplateSharedUserDTO, 0, len(shares))
	for _, share := range shares {
		user, ok := service.userRepository.FindByID(share.TargetUserID)
		if !ok {
			continue
		}
		out = append(out, model.ReportTemplateSharedUserDTO{
			ID:       user.ID,
			Username: user.Username,
			Name:     user.Name,
			Role:     user.Role,
		})
	}
	return out
}

func (service *reportingService) ListReportCases(_ context.Context) ([]model.ReportCaseDTO, *model.APIError) {
	return service.reportingRepository.FindAllReportCases(), nil
}

func (service *reportingService) GetReportCase(_ context.Context, caseID int64) (model.ReportCaseDetailDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	files := service.reportingRepository.FindReportCaseFiles(caseID)
	fileDTOs := make([]model.ReportCaseFileDTO, 0, len(files))
	for _, item := range files {
		fileDTOs = append(fileDTOs, item.ToDTO())
	}
	return model.ReportCaseDetailDTO{
		Case:           reportCase.ToDTO(),
		Files:          fileDTOs,
		Slices:         service.reportingRepository.FindDocumentSlicesByCaseID(caseID),
		Tables:         service.reportingRepository.FindTablesByCaseID(caseID),
		TableFragments: service.reportingRepository.FindTableFragmentsByCaseID(caseID),
		TableCells:     service.reportingRepository.FindTableCellsByCaseID(caseID),
		Facts:          toFactDTOs(service.reportingRepository.FindFactsByCaseID(caseID)),
		SourceRefs:     service.reportingRepository.FindSourceRefsByCaseID(caseID),
		AssemblyItems:  service.reportingRepository.FindAssemblyItemsByCaseID(caseID),
	}, nil
}

func (service *reportingService) CreateReportCase(_ context.Context, request model.CreateReportCaseRequest, operatorID int64) (model.ReportCaseDTO, *model.APIError) {
	request.Name = strings.TrimSpace(request.Name)
	request.SubjectName = strings.TrimSpace(request.SubjectName)
	if request.TemplateID <= 0 || request.Name == "" {
		return model.ReportCaseDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateId、name 不能为空")
	}
	template, ok := service.reportingRepository.FindReportTemplateByID(request.TemplateID)
	if !ok {
		return model.ReportCaseDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	guidanceItems := parseTemplateGuidanceFromAnnotations(template.AnnotationsJSON)
	summary, _ := json.Marshal(map[string]any{
		"fileCount":                            0,
		"readyCount":                           0,
		"reviewPendingCount":                   0,
		"templateCommentGuidance":              guidanceItems,
		"templateCommentGuidanceConsumed":      false,
		"templateCommentGuidanceConsumedCount": 0,
	})
	return service.reportingRepository.CreateReportCase(model.ReportCase{
		BaseEntity:  model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		TemplateID:  request.TemplateID,
		Name:        request.Name,
		SubjectID:   request.SubjectID,
		SubjectName: request.SubjectName,
		Status:      model.ReportCaseStatusDraft,
		SummaryJSON: summary,
	}), nil
}

func (service *reportingService) GetReportCaseGenerationContext(_ context.Context, caseID int64, consume bool, operatorID int64) (model.ReportCaseGenerationContextDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseGenerationContextDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	template, ok := service.reportingRepository.FindReportTemplateByID(reportCase.TemplateID)
	if !ok {
		return model.ReportCaseGenerationContextDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	summaryMap := map[string]any{}
	if len(reportCase.SummaryJSON) > 0 {
		_ = json.Unmarshal(reportCase.SummaryJSON, &summaryMap)
	}
	guidanceItems := parseTemplateGuidanceFromSummary(summaryMap)
	if len(guidanceItems) == 0 {
		guidanceItems = parseTemplateGuidanceFromAnnotations(template.AnnotationsJSON)
	}
	consumed := readBoolFromMap(summaryMap, "templateCommentGuidanceConsumed")
	consumedCount := readIntFromMap(summaryMap, "templateCommentGuidanceConsumedCount")
	remainingCount := len(guidanceItems)

	if consume && !consumed {
		consumed = true
		consumedCount += len(guidanceItems)
		remainingCount = 0
		summaryMap["templateCommentGuidanceConsumed"] = true
		summaryMap["templateCommentGuidanceConsumedCount"] = consumedCount
		summaryMap["templateCommentGuidanceConsumedAt"] = time.Now().UTC().Format(time.RFC3339)
		summaryMap["templateCommentGuidance"] = []model.TemplateCommentGuidanceItem{}
		updatedSummary, _ := json.Marshal(summaryMap)
		reportCase.SummaryJSON = updatedSummary
		reportCase.UpdatedBy = operatorID
		_, _ = service.reportingRepository.UpdateReportCase(reportCase)
	}

	return model.ReportCaseGenerationContextDTO{
		CaseID:         reportCase.ID,
		TemplateID:     template.ID,
		TemplateName:   template.Name,
		Outline:        template.OutlineJSON,
		GuidanceItems:  guidanceItems,
		Consumed:       consumed,
		ConsumedCount:  consumedCount,
		RemainingCount: remainingCount,
	}, nil
}

func (service *reportingService) AttachReportCaseFile(_ context.Context, caseID int64, request model.AttachReportCaseFileRequest, operatorID int64) (model.ReportCaseFileDTO, *model.APIError) {
	request.ManualCategory = strings.TrimSpace(request.ManualCategory)
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseFileDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	if request.FileID <= 0 || request.ManualCategory == "" {
		return model.ReportCaseFileDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId、manualCategory 不能为空")
	}
	if _, exists := service.reportingRepository.FindReportCaseFile(caseID, request.FileID); exists {
		return model.ReportCaseFileDTO{}, model.NewAPIError(400, response.CodeBadRequest, "该文件已挂接到当前报告")
	}
	fileEntity, ok := service.fileRepository.FindFileByID(request.FileID)
	if !ok || fileEntity.LatestVersionNo <= 0 {
		return model.ReportCaseFileDTO{}, model.NewAPIError(404, response.CodeNotFound, "底层文件不存在或无已上传版本")
	}
	notes, _ := json.Marshal(map[string]any{
		"attachedBy":       operatorID,
		"processingStatus": "not_started",
	})
	dto := service.reportingRepository.CreateReportCaseFile(model.ReportCaseFile{
		BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		CaseID:              reportCase.ID,
		FileID:              request.FileID,
		VersionNo:           fileEntity.LatestVersionNo,
		ManualCategory:      request.ManualCategory,
		Status:              model.ReportCaseFileStatusUploaded,
		ReviewStatus:        model.ReviewStatusPending,
		Confidence:          0,
		ParseStatus:         model.DocumentParseStatusPending,
		SourceType:          "",
		FileType:            "",
		OCRPending:          false,
		IsScannedSuspected:  false,
		ProcessingNotesJSON: notes,
	})
	_ = service.refreshCaseSummary(reportCase, operatorID)
	return dto, nil
}

func (service *reportingService) ProcessReportCase(ctx context.Context, caseID int64, _ model.ProcessReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	reportCase.Status = model.ReportCaseStatusProcessing
	reportCase.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCase(reportCase)

	for _, caseFile := range service.reportingRepository.FindReportCaseFiles(caseID) {
		if apiError := service.processSingleCaseFile(ctx, reportCase, caseFile, operatorID); apiError != nil {
			return model.ReportCaseDetailDTO{}, apiError
		}
	}

	reportCase.Status = model.ReportCaseStatusPendingReview
	reportCase.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCase(reportCase)
	_ = service.refreshCaseSummary(reportCase, operatorID)
	return service.GetReportCase(context.Background(), caseID)
}

func (service *reportingService) GetReviewQueue(_ context.Context, caseID int64) ([]model.ReviewQueueItemDTO, *model.APIError) {
	if _, ok := service.reportingRepository.FindReportCaseByID(caseID); !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	caseFiles := service.reportingRepository.FindReportCaseFiles(caseID)
	out := make([]model.ReviewQueueItemDTO, 0)
	for _, caseFile := range caseFiles {
		if caseFile.ReviewStatus != model.ReviewStatusPending {
			continue
		}
		facts := service.reportingRepository.FindFactsByCaseFileID(caseFile.ID)
		factIDs := make([]int64, 0, len(facts))
		for _, fact := range facts {
			factIDs = append(factIDs, fact.ID)
		}
		out = append(out, model.ReviewQueueItemDTO{
			CaseFile:   caseFile.ToDTO(),
			Facts:      toFactDTOs(facts),
			SourceRefs: toSourceRefDTOs(service.reportingRepository.FindSourceRefsByFactIDs(factIDs)),
		})
	}
	return out, nil
}

func (service *reportingService) ReviewReportCase(_ context.Context, caseID int64, request model.ReviewReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	for _, decision := range request.Decisions {
		caseFile, ok := service.reportingRepository.FindReportCaseFileByID(decision.CaseFileID)
		if !ok || caseFile.CaseID != caseID {
			return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告文件不存在")
		}
		decision.Decision = strings.TrimSpace(decision.Decision)
		decision.FinalSubCategory = strings.TrimSpace(decision.FinalSubCategory)
		switch decision.Decision {
		case model.ReviewStatusApproved:
			caseFile.ReviewStatus = model.ReviewStatusApproved
			caseFile.Status = model.ReportCaseFileStatusApproved
			if decision.FinalSubCategory != "" {
				caseFile.FinalSubCategory = decision.FinalSubCategory
			} else if caseFile.FinalSubCategory == "" {
				caseFile.FinalSubCategory = caseFile.SuggestedSubCategory
			}
			caseFile.UpdatedBy = operatorID
			_, _ = service.reportingRepository.UpdateReportCaseFile(caseFile)
			for _, fact := range service.reportingRepository.FindFactsByCaseFileID(caseFile.ID) {
				fact.ReviewStatus = model.ReviewStatusApproved
				_, _ = service.reportingRepository.UpdateExtractionFact(fact)
				if reportCase.SubjectID > 0 && (caseFile.ManualCategory == "主体" || caseFile.ManualCategory == "财务") {
					service.reportingRepository.CreateSubjectAsset(model.SubjectAsset{
						BaseEntity:  model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
						SubjectID:   reportCase.SubjectID,
						SubjectName: reportCase.SubjectName,
						AssetType:   caseFile.ManualCategory,
						AssetKey:    fact.FactKey,
						FactID:      fact.ID,
						Status:      model.ReviewStatusApproved,
					})
				}
			}
		case model.ReviewStatusRejected:
			caseFile.ReviewStatus = model.ReviewStatusRejected
			caseFile.Status = model.ReportCaseFileStatusRejected
			caseFile.UpdatedBy = operatorID
			_, _ = service.reportingRepository.UpdateReportCaseFile(caseFile)
			for _, fact := range service.reportingRepository.FindFactsByCaseFileID(caseFile.ID) {
				fact.ReviewStatus = model.ReviewStatusRejected
				_, _ = service.reportingRepository.UpdateExtractionFact(fact)
			}
		default:
			return model.ReportCaseDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "decision 仅支持 approved/rejected")
		}
	}
	if err := service.rebuildAssembly(reportCase, operatorID); err != nil {
		return model.ReportCaseDetailDTO{}, err
	}
	reportCase.Status = model.ReportCaseStatusReady
	reportCase.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCase(reportCase)
	_ = service.refreshCaseSummary(reportCase, operatorID)
	return service.GetReportCase(context.Background(), caseID)
}

func (service *reportingService) GetAssembly(_ context.Context, caseID int64) (model.AssemblyViewDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.AssemblyViewDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	facts := service.reportingRepository.FindFactsByCaseID(caseID)
	factIDs := make([]int64, 0, len(facts))
	for _, fact := range facts {
		factIDs = append(factIDs, fact.ID)
	}
	return model.AssemblyViewDTO{
		Case:       reportCase.ToDTO(),
		Items:      service.reportingRepository.FindAssemblyItemsByCaseID(caseID),
		Facts:      toFactDTOs(facts),
		SourceRefs: toSourceRefDTOs(service.reportingRepository.FindSourceRefsByFactIDs(factIDs)),
	}, nil
}

func (service *reportingService) ListSubjectAssets(_ context.Context, subjectID int64) ([]model.SubjectAssetDTO, *model.APIError) {
	return service.reportingRepository.FindSubjectAssets(subjectID), nil
}

func (service *reportingService) ListEnterpriseProjects(_ context.Context, enterpriseID int64) ([]model.EnterpriseProjectDTO, *model.APIError) {
	if enterpriseID < 0 {
		return nil, model.NewAPIError(400, response.CodeBadRequest, "enterpriseId 不合法")
	}
	return service.reportingRepository.FindEnterpriseProjectsByEnterpriseID(enterpriseID), nil
}

func (service *reportingService) CreateEnterpriseProject(_ context.Context, enterpriseID int64, request model.CreateEnterpriseProjectRequest, operatorID int64) (model.EnterpriseProjectDTO, *model.APIError) {
	if enterpriseID <= 0 {
		return model.EnterpriseProjectDTO{}, model.NewAPIError(400, response.CodeBadRequest, "enterpriseId 不合法")
	}
	if request.TemplateID <= 0 {
		return model.EnterpriseProjectDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateId 不合法")
	}
	enterprise, ok := service.enterpriseRepository.FindByID(enterpriseID)
	if !ok {
		return model.EnterpriseProjectDTO{}, model.NewAPIError(404, response.CodeNotFound, "企业不存在")
	}
	template, ok := service.reportingRepository.FindReportTemplateByID(request.TemplateID)
	if !ok {
		return model.EnterpriseProjectDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	name := strings.TrimSpace(request.Name)
	if name == "" {
		name = fmt.Sprintf("%s - %s", enterprise.ShortName, template.Name)
	}
	reportCase := service.reportingRepository.CreateReportCase(model.ReportCase{
		BaseEntity:  model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		TemplateID:  template.ID,
		Name:        name,
		SubjectID:   enterprise.ID,
		SubjectName: enterprise.ShortName,
		Status:      model.ReportCaseStatusDraft,
		SummaryJSON: json.RawMessage(`{}`),
	})
	project := service.reportingRepository.CreateEnterpriseProject(model.EnterpriseProject{
		BaseEntity:   model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		EnterpriseID: enterprise.ID,
		TemplateID:   template.ID,
		ReportCaseID: reportCase.ID,
		Name:         name,
		Status:       model.EnterpriseProjectStatusDraft,
	})
	return project, nil
}

func (service *reportingService) GetEnterpriseProject(ctx context.Context, projectID int64) (model.EnterpriseProjectDetailDTO, *model.APIError) {
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(projectID)
	if !ok {
		return model.EnterpriseProjectDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目不存在")
	}
	enterpriseDetail, ok := service.enterpriseRepository.FindByID(project.EnterpriseID)
	if !ok {
		return model.EnterpriseProjectDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "企业不存在")
	}
	template, ok := service.reportingRepository.FindReportTemplateByID(project.TemplateID)
	if !ok {
		return model.EnterpriseProjectDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	categories := parseTemplateCategories(template.CategoriesJSON)

	caseFiles := service.reportingRepository.FindReportCaseFiles(project.ReportCaseID)
	parseJobs := service.reportingRepository.FindReportParseJobsByProjectID(project.ID)
	parseJobByCaseFileID := map[int64]model.ReportParseJob{}
	for _, parseJob := range parseJobs {
		if existing, exists := parseJobByCaseFileID[parseJob.CaseFileID]; !exists || parseJob.ID > existing.ID {
			parseJobByCaseFileID[parseJob.CaseFileID] = parseJob
		}
	}

	groupItemsByCategory := map[string][]model.EnterpriseProjectUploadedFileItem{}
	for _, caseFile := range caseFiles {
		category := strings.TrimSpace(caseFile.ManualCategory)
		if category == "" {
			category = "未分类"
		}

		fileName := fmt.Sprintf("file-%d-v%d", caseFile.FileID, caseFile.VersionNo)
		if version, found := service.fileRepository.FindVersion(caseFile.FileID, caseFile.VersionNo); found && strings.TrimSpace(version.OriginName) != "" {
			fileName = version.OriginName
		}

		parseStatus := strings.TrimSpace(caseFile.ParseStatus)
		lastError := ""
		lastUpdated := caseFile.UpdatedAt
		if parseStatus == "" {
			parseStatus = model.ReportParseJobStatusPending
		}
		if parseJob, exists := parseJobByCaseFileID[caseFile.ID]; exists {
			if strings.TrimSpace(parseJob.Status) != "" {
				parseStatus = strings.TrimSpace(parseJob.Status)
			}
			if strings.TrimSpace(parseJob.ErrorMessage) != "" {
				lastError = parseJob.ErrorMessage
			}
			lastUpdated = parseJob.UpdatedAt
		}
		vectorStatus, vectorError := service.resolveVectorStatus(ctx, caseFile.FileID, caseFile.VersionNo)
		if strings.TrimSpace(lastError) == "" {
			lastError = strings.TrimSpace(vectorError)
		}
		item := model.EnterpriseProjectUploadedFileItem{
			CaseFileID:      caseFile.ID,
			FileID:          caseFile.FileID,
			VersionNo:       caseFile.VersionNo,
			FileName:        fileName,
			ManualCategory:  category,
			ParseStatus:     parseStatus,
			VectorStatus:    vectorStatus,
			CurrentStage:    deriveCurrentStage(parseStatus, vectorStatus),
			LastError:       lastError,
			LastUpdatedTime: lastUpdated,
		}
		groupItemsByCategory[category] = append(groupItemsByCategory[category], item)
	}

	uploadedFilesByCategory := make([]model.EnterpriseProjectUploadedFileGroup, 0)
	added := map[string]struct{}{}
	for _, category := range categories {
		name := strings.TrimSpace(fmt.Sprintf("%v", category["name"]))
		if name == "" {
			continue
		}
		items := groupItemsByCategory[name]
		if len(items) == 0 {
			continue
		}
		uploadedFilesByCategory = append(uploadedFilesByCategory, model.EnterpriseProjectUploadedFileGroup{
			Category: name,
			Items:    items,
		})
		added[name] = struct{}{}
	}
	for categoryName, items := range groupItemsByCategory {
		if len(items) == 0 {
			continue
		}
		if _, exists := added[categoryName]; exists {
			continue
		}
		uploadedFilesByCategory = append(uploadedFilesByCategory, model.EnterpriseProjectUploadedFileGroup{
			Category: categoryName,
			Items:    items,
		})
	}

	return model.EnterpriseProjectDetailDTO{
		Project:                 project.ToDTO(),
		Enterprise:              enterpriseDetail.EnterpriseDTO,
		Template:                template.ToDTO(),
		Categories:              categories,
		UploadedFilesByCategory: uploadedFilesByCategory,
	}, nil
}

func (service *reportingService) UploadEnterpriseProjectFiles(ctx context.Context, projectID int64, manualCategory string, fileHeaders []*multipart.FileHeader, operatorID int64) (model.UploadEnterpriseProjectFileResultDTO, *model.APIError) {
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(projectID)
	if !ok {
		return model.UploadEnterpriseProjectFileResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目不存在")
	}
	manualCategory = strings.TrimSpace(manualCategory)
	if manualCategory == "" {
		return model.UploadEnterpriseProjectFileResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "manualCategory 不能为空")
	}
	if len(fileHeaders) == 0 {
		return model.UploadEnterpriseProjectFileResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "请至少上传一个文件")
	}
	reportCase, ok := service.reportingRepository.FindReportCaseByID(project.ReportCaseID)
	if !ok {
		return model.UploadEnterpriseProjectFileResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}

	type fileCandidate struct {
		header *multipart.FileHeader
		group  string
	}
	candidates := make([]fileCandidate, 0, len(fileHeaders))
	for _, header := range fileHeaders {
		if header == nil || strings.TrimSpace(header.Filename) == "" {
			continue
		}
		candidates = append(candidates, fileCandidate{
			header: header,
			group:  detectFileTypeGroup(header.Filename),
		})
	}
	if len(candidates) == 0 {
		return model.UploadEnterpriseProjectFileResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "未找到有效上传文件")
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].group == candidates[j].group {
			return strings.ToLower(candidates[i].header.Filename) < strings.ToLower(candidates[j].header.Filename)
		}
		return candidates[i].group < candidates[j].group
	})

	results := make([]model.ReportCaseFileDTO, 0, len(candidates))
	for _, candidate := range candidates {
		session, apiError := service.fileService.CreateSession(ctx, operatorID, model.CreateUploadSessionRequest{
			BizKey: fmt.Sprintf("project:%d:%s", project.ID, candidate.group),
			FileID: 0,
		})
		if apiError != nil {
			return model.UploadEnterpriseProjectFileResultDTO{}, apiError
		}

		uploaded, apiError := service.fileService.UploadBySessionWithoutIndex(ctx, operatorID, session.ID, candidate.header)
		if apiError != nil {
			return model.UploadEnterpriseProjectFileResultDTO{}, apiError
		}
		caseFile, apiError := service.AttachReportCaseFile(ctx, reportCase.ID, model.AttachReportCaseFileRequest{
			FileID:         uploaded.FileID,
			ManualCategory: manualCategory,
		}, operatorID)
		if apiError != nil {
			return model.UploadEnterpriseProjectFileResultDTO{}, apiError
		}
		service.reportingRepository.CreateReportParseJob(model.ReportParseJob{
			ProjectID:      project.ID,
			CaseID:         reportCase.ID,
			CaseFileID:     caseFile.ID,
			FileID:         caseFile.FileID,
			VersionNo:      caseFile.VersionNo,
			ManualCategory: manualCategory,
			FileTypeGroup:  candidate.group,
			Status:         model.ReportParseJobStatusPending,
			RetryCount:     0,
			ErrorMessage:   "",
		})
		results = append(results, caseFile)
	}

	project.Status = model.EnterpriseProjectStatusProcessing
	project.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
	return model.UploadEnterpriseProjectFileResultDTO{
		ProjectID: project.ID,
		Items:     results,
	}, nil
}

func (service *reportingService) UpdateEnterpriseProjectFileManualAdjust(_ context.Context, projectID int64, caseFileID int64, finalSubCategory string, operatorID int64) (model.EnterpriseProjectFileManualAdjustResultDTO, *model.APIError) {
	if projectID <= 0 || caseFileID <= 0 {
		return model.EnterpriseProjectFileManualAdjustResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "projectId/caseFileId 不合法")
	}
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(projectID)
	if !ok {
		return model.EnterpriseProjectFileManualAdjustResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目不存在")
	}
	caseFile, ok := service.reportingRepository.FindReportCaseFileByID(caseFileID)
	if !ok || caseFile.CaseID != project.ReportCaseID {
		return model.EnterpriseProjectFileManualAdjustResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目文件不存在")
	}

	caseFile.FinalSubCategory = strings.TrimSpace(finalSubCategory)
	caseFile.UpdatedBy = operatorID
	updated, ok := service.reportingRepository.UpdateReportCaseFile(caseFile)
	if !ok {
		return model.EnterpriseProjectFileManualAdjustResultDTO{}, model.NewAPIError(500, response.CodeInternal, "保存人工调整失败")
	}
	if operatorID > 0 {
		project.UpdatedBy = operatorID
		_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
	}
	return model.EnterpriseProjectFileManualAdjustResultDTO{
		ProjectID:        project.ID,
		CaseFileID:       updated.ID,
		FinalSubCategory: updated.FinalSubCategory,
		UpdatedAt:        updated.UpdatedAt,
	}, nil
}

func (service *reportingService) GetEnterpriseProjectFileBlocks(_ context.Context, projectID int64, caseFileID int64) (model.EnterpriseProjectFileBlocksDTO, *model.APIError) {
	project, caseFile, apiError := service.resolveEnterpriseProjectCaseFile(projectID, caseFileID)
	if apiError != nil {
		return model.EnterpriseProjectFileBlocksDTO{}, apiError
	}
	slices := service.collectCaseFileEditableSlices(project, caseFile)
	sort.SliceStable(slices, func(i, j int) bool {
		if slices[i].ID == slices[j].ID {
			return slices[i].CreatedAt.Before(slices[j].CreatedAt)
		}
		return slices[i].ID < slices[j].ID
	})
	edits := parseCaseFileBlockEdits(caseFile.ProcessingNotesJSON)
	sections, blocks := buildCaseFileBlocks(slices, edits)
	return model.EnterpriseProjectFileBlocksDTO{
		ProjectID:  project.ID,
		CaseFileID: caseFile.ID,
		Sections:   sections,
		Blocks:     blocks,
	}, nil
}

func (service *reportingService) UpdateEnterpriseProjectFileBlock(_ context.Context, projectID int64, caseFileID int64, blockID int64, currentHTML string, operatorID int64) (model.EnterpriseProjectFileBlockUpdateResultDTO, *model.APIError) {
	if blockID <= 0 {
		return model.EnterpriseProjectFileBlockUpdateResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "blockId 不合法")
	}
	project, caseFile, apiError := service.resolveEnterpriseProjectCaseFile(projectID, caseFileID)
	if apiError != nil {
		return model.EnterpriseProjectFileBlockUpdateResultDTO{}, apiError
	}
	slices := service.collectCaseFileEditableSlices(project, caseFile)
	sliceMap := map[int64]model.DocumentSlice{}
	for _, slice := range slices {
		sliceMap[slice.ID] = slice
	}
	targetSlice, ok := sliceMap[blockID]
	if !ok {
		return model.EnterpriseProjectFileBlockUpdateResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "分块不存在")
	}
	if !isEditableSliceType(targetSlice.SliceType) {
		return model.EnterpriseProjectFileBlockUpdateResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "当前分块不支持编辑")
	}

	nextHTML := strings.TrimSpace(currentHTML)
	if nextHTML == "" {
		nextHTML = defaultSliceHTML(targetSlice)
	}
	notes := parseCaseFileProcessingNotes(caseFile.ProcessingNotesJSON)
	entries := parseBlockEditEntries(notes["blockEdits"])
	now := time.Now().UTC()
	entries[strconv.FormatInt(blockID, 10)] = map[string]any{
		"html":      nextHTML,
		"updatedAt": now.Format(time.RFC3339),
	}
	notes["blockEdits"] = entries
	serializedNotes, err := json.Marshal(notes)
	if err != nil {
		return model.EnterpriseProjectFileBlockUpdateResultDTO{}, model.NewAPIError(500, response.CodeInternal, "保存分块内容失败")
	}
	caseFile.ProcessingNotesJSON = serializedNotes
	caseFile.UpdatedBy = operatorID
	updated, ok := service.reportingRepository.UpdateReportCaseFile(caseFile)
	if !ok {
		return model.EnterpriseProjectFileBlockUpdateResultDTO{}, model.NewAPIError(500, response.CodeInternal, "保存分块内容失败")
	}
	if operatorID > 0 {
		project.UpdatedBy = operatorID
		_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
	}
	return model.EnterpriseProjectFileBlockUpdateResultDTO{
		ProjectID:   project.ID,
		CaseFileID:  updated.ID,
		BlockID:     blockID,
		CurrentHTML: nextHTML,
		UpdatedAt:   updated.UpdatedAt,
	}, nil
}

func (service *reportingService) ConfirmEnterpriseProjectVectorization(ctx context.Context, projectID int64, operatorID int64) (model.EnterpriseProjectVectorConfirmResultDTO, *model.APIError) {
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(projectID)
	if !ok {
		return model.EnterpriseProjectVectorConfirmResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目不存在")
	}
	if service.knowledgeQueue == nil {
		return model.EnterpriseProjectVectorConfirmResultDTO{}, model.NewAPIError(503, response.CodeInternal, "向量服务不可用")
	}

	jobs := service.reportingRepository.FindReportParseJobsByProjectID(project.ID)
	result := model.EnterpriseProjectVectorConfirmResultDTO{
		ProjectID: project.ID,
		Items:     make([]model.EnterpriseProjectVectorConfirmItemDTO, 0, len(jobs)),
	}
	for _, job := range jobs {
		item := model.EnterpriseProjectVectorConfirmItemDTO{
			CaseFileID:     job.CaseFileID,
			FileID:         job.FileID,
			VersionNo:      job.VersionNo,
			ManualCategory: job.ManualCategory,
			ParseStatus:    strings.TrimSpace(job.Status),
			Action:         "skip",
		}
		if item.ParseStatus == "" {
			item.ParseStatus = model.ReportParseJobStatusPending
		}
		result.Total++
		if item.ParseStatus != model.ReportParseJobStatusSucceeded {
			item.Reason = "解析未完成"
			item.VectorStatus = vectorStatusNotEnqueued
			result.Skipped++
			result.Items = append(result.Items, item)
			continue
		}

		vectorStatus, vectorError := service.resolveVectorStatus(ctx, job.FileID, job.VersionNo)
		item.VectorStatus = vectorStatus
		if strings.TrimSpace(vectorError) != "" {
			item.Reason = vectorError
		}
		switch vectorStatus {
		case model.KnowledgeIndexJobStatusPending, model.KnowledgeIndexJobStatusRunning, model.KnowledgeIndexJobStatusSucceeded:
			item.Action = "skip"
			if strings.TrimSpace(item.Reason) == "" {
				item.Reason = "向量任务已存在"
			}
			result.Skipped++
		default:
			apiError := service.knowledgeQueue.Enqueue(ctx, job.FileID, job.VersionNo)
			if apiError != nil {
				item.Action = "failed"
				item.VectorStatus = vectorStatusStatusError
				item.Reason = apiError.Message
				result.Failed++
			} else {
				item.Action = "enqueue"
				item.VectorStatus = model.KnowledgeIndexJobStatusPending
				item.Reason = ""
				result.Enqueued++
			}
		}
		result.Items = append(result.Items, item)
	}
	if operatorID > 0 {
		project.UpdatedBy = operatorID
		_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
	}
	return result, nil
}

func (service *reportingService) TerminateEnterpriseProjectFile(ctx context.Context, projectID int64, caseFileID int64, operatorID int64) (model.EnterpriseProjectFileTerminateResultDTO, *model.APIError) {
	if projectID <= 0 || caseFileID <= 0 {
		return model.EnterpriseProjectFileTerminateResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "projectId/caseFileId 不合法")
	}
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(projectID)
	if !ok {
		return model.EnterpriseProjectFileTerminateResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目不存在")
	}
	caseFile, ok := service.reportingRepository.FindReportCaseFileByID(caseFileID)
	if !ok || caseFile.CaseID != project.ReportCaseID {
		return model.EnterpriseProjectFileTerminateResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目文件不存在")
	}

	jobs := service.reportingRepository.FindReportParseJobsByProjectID(project.ID)
	var targetJob *model.ReportParseJob
	for index := range jobs {
		job := jobs[index]
		if job.CaseFileID != caseFile.ID {
			continue
		}
		if targetJob == nil || job.ID > targetJob.ID {
			cloned := job
			targetJob = &cloned
		}
	}
	if targetJob == nil {
		return model.EnterpriseProjectFileTerminateResultDTO{}, model.NewAPIError(404, response.CodeNotFound, "未找到可终止的解析任务")
	}

	parseStatus := targetJob.Status
	if targetJob.Status == model.ReportParseJobStatusPending || targetJob.Status == model.ReportParseJobStatusRunning {
		now := time.Now().UTC()
		targetJob.Status = model.ReportParseJobStatusCancelled
		targetJob.ErrorMessage = terminatedByUserMessage
		targetJob.FinishedAt = &now
		targetJob.RetryCount = 0
		_, _ = service.reportingRepository.UpdateReportParseJob(*targetJob)
		parseStatus = model.ReportParseJobStatusCancelled
	}

	vectorStatus, vectorErrorMessage := service.resolveVectorStatus(ctx, targetJob.FileID, targetJob.VersionNo)
	if service.knowledgeQueue != nil && (vectorStatus == model.KnowledgeIndexJobStatusPending || vectorStatus == model.KnowledgeIndexJobStatusRunning) {
		if apiError := service.knowledgeQueue.Cancel(ctx, targetJob.FileID, targetJob.VersionNo); apiError == nil {
			vectorStatus = model.KnowledgeIndexJobStatusCancelled
			vectorErrorMessage = ""
		} else if isAPIErrorStatus(apiError, 404) {
			vectorStatus = vectorStatusNotEnqueued
			vectorErrorMessage = ""
		} else if isAPIErrorStatus(apiError, 503) {
			vectorStatus = vectorStatusUnavailable
			vectorErrorMessage = apiError.Message
		} else {
			vectorStatus = vectorStatusStatusError
			vectorErrorMessage = apiError.Message
		}
	}

	if operatorID > 0 {
		project.UpdatedBy = operatorID
		_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
	}

	message := "终止请求已处理"
	if strings.TrimSpace(vectorErrorMessage) != "" {
		message = message + "：" + vectorErrorMessage
	}
	return model.EnterpriseProjectFileTerminateResultDTO{
		ProjectID:    project.ID,
		CaseFileID:   caseFile.ID,
		ParseStatus:  parseStatus,
		VectorStatus: vectorStatus,
		Message:      message,
	}, nil
}

func (service *reportingService) GetEnterpriseProjectProgress(ctx context.Context, projectID int64) (model.EnterpriseProjectProgressDTO, *model.APIError) {
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(projectID)
	if !ok {
		return model.EnterpriseProjectProgressDTO{}, model.NewAPIError(404, response.CodeNotFound, "项目不存在")
	}
	jobs := service.reportingRepository.FindReportParseJobsByProjectID(project.ID)
	items := make([]model.ReportParseJobProgressDTO, 0, len(jobs))
	allSucceeded := len(jobs) > 0
	hasFailed := false
	for _, job := range jobs {
		fileName := fmt.Sprintf("file-%d-v%d", job.FileID, job.VersionNo)
		fileEntity, ok := service.fileRepository.FindVersion(job.FileID, job.VersionNo)
		if ok && strings.TrimSpace(fileEntity.OriginName) != "" {
			fileName = fileEntity.OriginName
		}
		errorMessage := strings.TrimSpace(job.ErrorMessage)
		vectorStatus := vectorStatusNotEnqueued
		if service.knowledgeQueue == nil {
			vectorStatus = vectorStatusUnavailable
		} else {
			status, apiError := service.knowledgeQueue.GetStatus(ctx, job.FileID, job.VersionNo)
			if apiError == nil {
				vectorStatus = strings.TrimSpace(status.Status)
				if vectorStatus == "" {
					vectorStatus = vectorStatusStatusError
				}
				if vectorStatus == model.KnowledgeIndexJobStatusFailed && strings.TrimSpace(status.ErrorMessage) != "" {
					errorMessage = status.ErrorMessage
				}
			} else if isAPIErrorStatus(apiError, 404) {
				vectorStatus = vectorStatusNotEnqueued
			} else if isAPIErrorStatus(apiError, 503) {
				vectorStatus = vectorStatusUnavailable
				if strings.TrimSpace(errorMessage) == "" {
					errorMessage = apiError.Message
				}
			} else {
				vectorStatus = vectorStatusStatusError
				if strings.TrimSpace(errorMessage) == "" {
					errorMessage = apiError.Message
				}
			}
		}
		currentStage := deriveCurrentStage(job.Status, vectorStatus)

		parseSucceeded := job.Status == model.ReportParseJobStatusSucceeded
		vectorSucceeded := vectorStatus == model.KnowledgeIndexJobStatusSucceeded || vectorStatus == vectorStatusUnavailable
		if !parseSucceeded || !vectorSucceeded {
			allSucceeded = false
		}
		if job.Status == model.ReportParseJobStatusFailed ||
			job.Status == model.ReportParseJobStatusCancelled ||
			vectorStatus == model.KnowledgeIndexJobStatusFailed ||
			vectorStatus == model.KnowledgeIndexJobStatusCancelled ||
			vectorStatus == vectorStatusStatusError {
			hasFailed = true
		}
		items = append(items, model.ReportParseJobProgressDTO{
			JobID:          job.ID,
			CaseFileID:     job.CaseFileID,
			FileID:         job.FileID,
			VersionNo:      job.VersionNo,
			FileName:       fileName,
			ManualCategory: job.ManualCategory,
			FileTypeGroup:  job.FileTypeGroup,
			ParseStatus:    job.Status,
			VectorStatus:   vectorStatus,
			CurrentStage:   currentStage,
			ErrorMessage:   errorMessage,
			UpdatedAt:      job.UpdatedAt,
			StartedAt:      job.StartedAt,
			FinishedAt:     job.FinishedAt,
		})
	}
	nextStatus := project.Status
	switch {
	case hasFailed:
		nextStatus = model.EnterpriseProjectStatusFailed
	case allSucceeded:
		nextStatus = model.EnterpriseProjectStatusCompleted
	case len(items) > 0:
		nextStatus = model.EnterpriseProjectStatusProcessing
	}
	if nextStatus != project.Status {
		project.Status = nextStatus
		project.UpdatedBy = project.UpdatedBy
		_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
	}
	return model.EnterpriseProjectProgressDTO{
		ProjectID: project.ID,
		Items:     items,
	}, nil
}

func (service *reportingService) RunParseQueueOnce(ctx context.Context) bool {
	job, ok := service.reportingRepository.ClaimNextReportParseJob(3)
	if !ok {
		return false
	}
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(job.ProjectID)
	if !ok {
		now := time.Now().UTC()
		job.Status = model.ReportParseJobStatusFailed
		job.RetryCount++
		job.ErrorMessage = "项目不存在"
		job.FinishedAt = &now
		_, _ = service.reportingRepository.UpdateReportParseJob(job)
		return true
	}
	reportCase, ok := service.reportingRepository.FindReportCaseByID(job.CaseID)
	if !ok {
		now := time.Now().UTC()
		job.Status = model.ReportParseJobStatusFailed
		job.RetryCount++
		job.ErrorMessage = "报告实例不存在"
		job.FinishedAt = &now
		_, _ = service.reportingRepository.UpdateReportParseJob(job)
		return true
	}
	caseFile, ok := service.reportingRepository.FindReportCaseFileByID(job.CaseFileID)
	if !ok {
		now := time.Now().UTC()
		job.Status = model.ReportParseJobStatusFailed
		job.RetryCount++
		job.ErrorMessage = "报告文件不存在"
		job.FinishedAt = &now
		_, _ = service.reportingRepository.UpdateReportParseJob(job)
		return true
	}
	operatorID := project.UpdatedBy
	if operatorID <= 0 {
		operatorID = project.CreatedBy
	}
	if operatorID <= 0 {
		operatorID = 1
	}
	if apiError := service.processSingleCaseFile(ctx, reportCase, caseFile, operatorID); apiError != nil {
		if service.isParseJobCancelled(job.ID) {
			return true
		}
		now := time.Now().UTC()
		job.Status = model.ReportParseJobStatusFailed
		job.RetryCount++
		job.ErrorMessage = apiError.Message
		job.FinishedAt = &now
		_, _ = service.reportingRepository.UpdateReportParseJob(job)
		project.Status = model.EnterpriseProjectStatusFailed
		project.UpdatedBy = operatorID
		_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
		return true
	}
	if service.isParseJobCancelled(job.ID) {
		return true
	}
	if service.isParseJobCancelled(job.ID) {
		return true
	}
	now := time.Now().UTC()
	job.Status = model.ReportParseJobStatusSucceeded
	job.ErrorMessage = ""
	job.FinishedAt = &now
	_, _ = service.reportingRepository.UpdateReportParseJob(job)
	project.Status = model.EnterpriseProjectStatusProcessing
	project.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateEnterpriseProject(project)
	return true
}

func (service *reportingService) StartParseWorker(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for service.RunParseQueueOnce(ctx) {
				}
			}
		}
	}()
}

func parseTemplateCategories(raw json.RawMessage) []map[string]any {
	if len(raw) == 0 {
		return []map[string]any{}
	}
	items := make([]map[string]any, 0)
	if err := json.Unmarshal(raw, &items); err != nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name == "" {
			continue
		}
		key := strings.TrimSpace(fmt.Sprintf("%v", item["key"]))
		if key == "" {
			key = normalizeKey(name)
		}
		out = append(out, map[string]any{
			"key":      key,
			"name":     name,
			"required": item["required"] == true,
		})
	}
	return out
}

func detectFileTypeGroup(fileName string) string {
	ext := strings.ToLower(strings.TrimSpace(filepath.Ext(fileName)))
	switch ext {
	case ".pdf":
		return "pdf"
	case ".doc", ".docx":
		return "word"
	case ".xls", ".xlsx", ".csv", ".tsv":
		return "sheet"
	case ".png", ".jpg", ".jpeg", ".bmp", ".webp":
		return "image"
	case ".txt", ".md", ".json":
		return "text"
	default:
		return "other"
	}
}

func deriveCurrentStage(parseStatus string, vectorStatus string) string {
	switch parseStatus {
	case model.ReportParseJobStatusPending:
		return "解析排队"
	case model.ReportParseJobStatusRunning:
		return "解析中"
	case model.ReportParseJobStatusFailed:
		return "解析失败"
	case model.ReportParseJobStatusCancelled:
		return "解析已终止"
	}
	switch vectorStatus {
	case model.KnowledgeIndexJobStatusPending:
		return "向量排队"
	case model.KnowledgeIndexJobStatusRunning:
		return "向量中"
	case model.KnowledgeIndexJobStatusFailed:
		return "向量失败"
	case model.KnowledgeIndexJobStatusCancelled:
		return "向量已终止"
	case model.KnowledgeIndexJobStatusSucceeded:
		return "完成"
	case vectorStatusNotEnqueued:
		return "向量未入队"
	case vectorStatusUnavailable:
		return "向量不可用"
	case vectorStatusStatusError:
		return "向量状态异常"
	default:
		return "待处理"
	}
}

func (service *reportingService) isParseJobCancelled(jobID int64) bool {
	if jobID <= 0 {
		return false
	}
	latest, ok := service.reportingRepository.FindReportParseJobByID(jobID)
	if !ok {
		return false
	}
	return latest.Status == model.ReportParseJobStatusCancelled
}

func (service *reportingService) resolveVectorStatus(ctx context.Context, fileID int64, versionNo int) (string, string) {
	if service.knowledgeQueue == nil {
		return vectorStatusUnavailable, ""
	}
	status, apiError := service.knowledgeQueue.GetStatus(ctx, fileID, versionNo)
	if apiError == nil {
		normalized := strings.TrimSpace(status.Status)
		if normalized == "" {
			return vectorStatusStatusError, "向量状态为空"
		}
		return normalized, strings.TrimSpace(status.ErrorMessage)
	}
	if isAPIErrorStatus(apiError, 404) {
		return vectorStatusNotEnqueued, ""
	}
	if isAPIErrorStatus(apiError, 503) {
		return vectorStatusUnavailable, strings.TrimSpace(apiError.Message)
	}
	return vectorStatusStatusError, strings.TrimSpace(apiError.Message)
}

func isAPIErrorStatus(apiError *model.APIError, statusCode int) bool {
	if apiError == nil {
		return false
	}
	return apiError.HTTPStatus == statusCode
}

func (service *reportingService) resolveEnterpriseProjectCaseFile(projectID int64, caseFileID int64) (model.EnterpriseProject, model.ReportCaseFile, *model.APIError) {
	if projectID <= 0 || caseFileID <= 0 {
		return model.EnterpriseProject{}, model.ReportCaseFile{}, model.NewAPIError(400, response.CodeBadRequest, "projectId/caseFileId 不合法")
	}
	project, ok := service.reportingRepository.FindEnterpriseProjectByID(projectID)
	if !ok {
		return model.EnterpriseProject{}, model.ReportCaseFile{}, model.NewAPIError(404, response.CodeNotFound, "项目不存在")
	}
	caseFile, ok := service.reportingRepository.FindReportCaseFileByID(caseFileID)
	if !ok || caseFile.CaseID != project.ReportCaseID {
		return model.EnterpriseProject{}, model.ReportCaseFile{}, model.NewAPIError(404, response.CodeNotFound, "项目文件不存在")
	}
	return project, caseFile, nil
}

func (service *reportingService) collectCaseFileEditableSlices(project model.EnterpriseProject, caseFile model.ReportCaseFile) []model.DocumentSlice {
	slices := service.reportingRepository.FindDocumentSlicesByCaseFileID(caseFile.ID)
	if len(slices) > 0 {
		return slices
	}
	caseSlices := service.reportingRepository.FindDocumentSlicesByCaseID(project.ReportCaseID)
	if len(caseSlices) == 0 {
		return nil
	}
	out := make([]model.DocumentSlice, 0)
	for _, row := range caseSlices {
		if row.CaseFileID == caseFile.ID {
			out = append(out, model.DocumentSlice{
				ID:         row.ID,
				CaseFileID: row.CaseFileID,
				FileID:     row.FileID,
				VersionNo:  row.VersionNo,
				SliceType:  row.SliceType,
				SourceType: row.SourceType,
				Title:      row.Title,
				TitleLevel: row.TitleLevel,
				PageStart:  row.PageStart,
				PageEnd:    row.PageEnd,
				RawText:    row.RawText,
				CleanText:  row.CleanText,
				CreatedAt:  row.CreatedAt,
			})
			continue
		}
		if row.FileID == caseFile.FileID && row.VersionNo == caseFile.VersionNo {
			out = append(out, model.DocumentSlice{
				ID:         row.ID,
				CaseFileID: caseFile.ID,
				FileID:     row.FileID,
				VersionNo:  row.VersionNo,
				SliceType:  row.SliceType,
				SourceType: row.SourceType,
				Title:      row.Title,
				TitleLevel: row.TitleLevel,
				PageStart:  row.PageStart,
				PageEnd:    row.PageEnd,
				RawText:    row.RawText,
				CleanText:  row.CleanText,
				CreatedAt:  row.CreatedAt,
			})
		}
	}
	return out
}

func parseCaseFileProcessingNotes(raw json.RawMessage) map[string]any {
	notes := map[string]any{}
	if len(raw) == 0 {
		return notes
	}
	_ = json.Unmarshal(raw, &notes)
	return notes
}

func parseBlockEditEntries(raw any) map[string]map[string]any {
	out := map[string]map[string]any{}
	rows, ok := raw.(map[string]any)
	if !ok {
		return out
	}
	for key, value := range rows {
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		out[key] = entry
	}
	return out
}

func parseCaseFileBlockEdits(raw json.RawMessage) map[int64]string {
	notes := parseCaseFileProcessingNotes(raw)
	rows := parseBlockEditEntries(notes["blockEdits"])
	out := map[int64]string{}
	for key, value := range rows {
		blockID, err := strconv.ParseInt(strings.TrimSpace(key), 10, 64)
		if err != nil || blockID <= 0 {
			continue
		}
		currentHTML := strings.TrimSpace(fmt.Sprintf("%v", value["html"]))
		if currentHTML == "" {
			continue
		}
		out[blockID] = currentHTML
	}
	return out
}

func buildCaseFileBlocks(slices []model.DocumentSlice, edits map[int64]string) ([]model.EnterpriseProjectFileBlockSectionDTO, []model.EnterpriseProjectFileBlockItemDTO) {
	sections := make([]model.EnterpriseProjectFileBlockSectionDTO, 0)
	blocks := make([]model.EnterpriseProjectFileBlockItemDTO, 0)
	if len(slices) == 0 {
		return sections, blocks
	}
	rootSection := model.EnterpriseProjectFileBlockSectionDTO{
		SectionID: "section-root",
		Title:     "内容",
		Level:     1,
		Order:     0,
		BlockIDs:  make([]int64, 0),
	}
	sectionByID := map[string]*model.EnterpriseProjectFileBlockSectionDTO{
		rootSection.SectionID: &rootSection,
	}
	currentSectionID := rootSection.SectionID

	appendSection := func(sectionID string, title string, level int, order int) {
		if _, exists := sectionByID[sectionID]; exists {
			return
		}
		section := &model.EnterpriseProjectFileBlockSectionDTO{
			SectionID: sectionID,
			Title:     title,
			Level:     level,
			Order:     order,
			BlockIDs:  make([]int64, 0),
		}
		sections = append(sections, *section)
		sectionByID[sectionID] = section
	}

	for _, slice := range slices {
		if !isEditableSliceType(slice.SliceType) {
			continue
		}
		if slice.SliceType == model.DocumentStructureSection {
			sectionID := fmt.Sprintf("section-%d", slice.ID)
			title := strings.TrimSpace(slice.Title)
			if title == "" {
				title = deriveSliceTextSummary(slice.CleanText, 26)
			}
			if title == "" {
				title = fmt.Sprintf("章节-%d", slice.ID)
			}
			appendSection(sectionID, title, 2, len(sections)+1)
			currentSectionID = sectionID
		}
		defaultHTML := defaultSliceHTML(slice)
		currentHTML := defaultHTML
		if edited, ok := edits[slice.ID]; ok && strings.TrimSpace(edited) != "" {
			currentHTML = edited
		}
		block := model.EnterpriseProjectFileBlockItemDTO{
			BlockID:     slice.ID,
			SectionID:   currentSectionID,
			SliceType:   slice.SliceType,
			SourceType:  slice.SourceType,
			Title:       strings.TrimSpace(slice.Title),
			PageStart:   slice.PageStart,
			PageEnd:     slice.PageEnd,
			InitialHTML: defaultHTML,
			CurrentHTML: currentHTML,
			LastSavedAt: slice.CreatedAt,
		}
		blocks = append(blocks, block)
		if section, ok := sectionByID[currentSectionID]; ok {
			section.BlockIDs = append(section.BlockIDs, block.BlockID)
		}
	}
	if len(rootSection.BlockIDs) > 0 {
		sections = append([]model.EnterpriseProjectFileBlockSectionDTO{rootSection}, sections...)
	}
	// 刷新 sectionByID 的快照值（前面存的是指针副本）
	finalSections := make([]model.EnterpriseProjectFileBlockSectionDTO, 0, len(sections))
	for _, section := range sections {
		if latest, ok := sectionByID[section.SectionID]; ok {
			finalSections = append(finalSections, *latest)
		} else {
			finalSections = append(finalSections, section)
		}
	}
	return finalSections, blocks
}

func defaultSliceHTML(slice model.DocumentSlice) string {
	text := strings.TrimSpace(slice.CleanText)
	if text == "" {
		text = strings.TrimSpace(slice.RawText)
	}
	escaped := html.EscapeString(text)
	escaped = strings.ReplaceAll(escaped, "\n", "<br>")
	if slice.SliceType == model.DocumentStructureSection {
		title := strings.TrimSpace(slice.Title)
		if title == "" {
			title = deriveSliceTextSummary(text, 24)
		}
		if title == "" {
			title = "章节"
		}
		if escaped == "" {
			return fmt.Sprintf("<h2>%s</h2>", html.EscapeString(title))
		}
		return fmt.Sprintf("<h2>%s</h2><p>%s</p>", html.EscapeString(title), escaped)
	}
	if escaped == "" {
		return "<p></p>"
	}
	return fmt.Sprintf("<p>%s</p>", escaped)
}

func deriveSliceTextSummary(value string, maxLen int) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) <= maxLen {
		return trimmed
	}
	return string(runes[:maxLen]) + "…"
}

func isEditableSliceType(sliceType string) bool {
	switch sliceType {
	case model.DocumentStructureSection, model.DocumentStructureParagraph, model.DocumentStructurePage:
		return true
	default:
		return false
	}
}

func (service *reportingService) processSingleCaseFile(ctx context.Context, reportCase model.ReportCase, caseFile model.ReportCaseFile, operatorID int64) *model.APIError {
	fileEntity, ok := service.fileRepository.FindFileByID(caseFile.FileID)
	if !ok || fileEntity.LatestVersionNo <= 0 {
		return model.NewAPIError(404, response.CodeNotFound, "底层文件不存在")
	}
	caseFile.VersionNo = fileEntity.LatestVersionNo
	parsed, apiError := service.documentParseService.ParseCaseFile(ctx, caseFile)
	if apiError != nil {
		return apiError
	}

	caseFile.SuggestedSubCategory = service.suggestSubCategory(caseFile.ManualCategory, parsed.Version.OriginName)
	caseFile.FinalSubCategory = ""
	caseFile.Status = model.ReportCaseFileStatusPendingReview
	caseFile.ReviewStatus = model.ReviewStatusPending
	caseFile.Confidence = service.deriveConfidence(parsed.Version.OriginName, parsed.Profile)
	caseFile.FileType = parsed.Profile.FileType
	caseFile.SourceType = parsed.Profile.SourceType
	caseFile.ParseStatus = chooseParseStatus(parsed)
	caseFile.OCRPending = parsed.OCRTask != nil && parsed.OCRTask.Status != model.OCRTaskStatusSucceeded
	caseFile.IsScannedSuspected = parsed.Profile.IsScannedSuspected
	notes, _ := json.Marshal(map[string]any{
		"originName":          parsed.Version.OriginName,
		"mimeType":            parsed.Version.MimeType,
		"sizeBytes":           parsed.Version.SizeBytes,
		"bizClass":            parsed.Profile.BizClass,
		"parseStrategy":       parsed.Profile.ParseStrategy,
		"hasTextLayer":        parsed.Profile.HasTextLayer,
		"textDensity":         parsed.Profile.TextDensity,
		"traceable":           true,
		"ocrProvider":         reportingOCRProvider(parsed),
		"ocrPending":          caseFile.OCRPending,
		"ocrTaskId":           reportingOCRTaskID(parsed),
		"ocrTaskStatus":       reportingOCRTaskStatus(parsed),
		"ocrSkipReason":       parsed.Profile.OCRSkipReason,
		"imageOcrApplied":     parsed.Profile.ImageOCRApplied,
		"imageOcrAppendCount": parsed.Profile.ImageOCRAppendCount,
		"ocrQueueMode":        parsed.Profile.OCRQueueMode,
		"isScannedSuspected":  parsed.Profile.IsScannedSuspected,
		"pdfDiagnostics":      parsed.Profile.PDFDiagnostics,
	})
	caseFile.ProcessingNotesJSON = notes
	caseFile.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCaseFile(caseFile)

	service.reportingRepository.DeleteSlicesByCaseFileID(caseFile.ID)
	service.reportingRepository.DeleteTablesByCaseFileID(caseFile.ID)
	removedFactIDs := service.reportingRepository.DeleteFactsByCaseFileID(caseFile.ID)
	service.reportingRepository.DeleteSourceRefsByFactIDs(removedFactIDs)

	persistedSlices := make([]model.DocumentSliceDTO, 0, len(parsed.Slices))
	for _, slice := range parsed.Slices {
		slice.CaseFileID = caseFile.ID
		slice.FileID = caseFile.FileID
		slice.VersionNo = parsed.Version.VersionNo
		persistedSlices = append(persistedSlices, service.reportingRepository.CreateDocumentSlice(slice))
	}

	persistedTables := make([]model.DocumentTableDTO, 0, len(parsed.Tables))
	persistedFragments := make([]model.DocumentTableFragmentDTO, 0, len(parsed.TableFragments))
	persistedCells := make([]model.DocumentTableCellDTO, 0, len(parsed.TableCells))
	tableIDMap := make(map[int64]int64, len(parsed.Tables))
	fragmentIDMap := make(map[int64]int64, len(parsed.TableFragments))

	if len(parsed.Tables) > 0 {
		for index, table := range parsed.Tables {
			originalTableID := table.ID
			if originalTableID == 0 {
				originalTableID = int64(index + 1)
			}
			table.CaseFileID = caseFile.ID
			table.FileID = caseFile.FileID
			table.VersionNo = parsed.Version.VersionNo
			persisted := service.reportingRepository.CreateDocumentTable(table)
			persistedTables = append(persistedTables, persisted)
			tableIDMap[originalTableID] = persisted.ID
		}
	}
	if len(parsed.TableFragments) > 0 && len(persistedTables) > 0 {
		defaultTableID := persistedTables[0].ID
		for index, fragment := range parsed.TableFragments {
			originalFragmentID := fragment.ID
			if originalFragmentID == 0 {
				originalFragmentID = int64(index + 1)
			}
			fragment.CaseFileID = caseFile.ID
			if mappedTableID, ok := tableIDMap[fragment.TableID]; ok {
				fragment.TableID = mappedTableID
			} else {
				fragment.TableID = defaultTableID
			}
			persisted := service.reportingRepository.CreateDocumentTableFragment(fragment)
			persistedFragments = append(persistedFragments, persisted)
			fragmentIDMap[originalFragmentID] = persisted.ID
		}
	}
	if len(parsed.TableCells) > 0 && len(persistedTables) > 0 && len(persistedFragments) > 0 {
		defaultTableID := persistedTables[0].ID
		defaultFragmentID := persistedFragments[0].ID
		for _, cell := range parsed.TableCells {
			cell.CaseFileID = caseFile.ID
			if mappedTableID, ok := tableIDMap[cell.TableID]; ok {
				cell.TableID = mappedTableID
			} else {
				cell.TableID = defaultTableID
			}
			if mappedFragmentID, ok := fragmentIDMap[cell.FragmentID]; ok {
				cell.FragmentID = mappedFragmentID
			} else {
				cell.FragmentID = defaultFragmentID
			}
			persistedCells = append(persistedCells, service.reportingRepository.CreateDocumentTableCell(cell))
		}
	}

	service.createProfileFact(caseFile, parsed, persistedSlices, operatorID)
	service.createSliceFacts(reportCase, caseFile, parsed, persistedSlices, operatorID)
	service.createTableFacts(reportCase, caseFile, persistedTables, persistedCells, operatorID)
	return nil
}

func (service *reportingService) createProfileFact(caseFile model.ReportCaseFile, parsed ParsedDocument, slices []model.DocumentSliceDTO, operatorID int64) {
	profileValue, _ := json.Marshal(parsed.Profile)
	fact := service.reportingRepository.CreateExtractionFact(model.ExtractionFact{
		BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		CaseID:              caseFile.CaseID,
		CaseFileID:          caseFile.ID,
		FactType:            "document_profile",
		FactKey:             "profile." + normalizeKey(caseFile.ManualCategory),
		FactValueJSON:       profileValue,
		NormalizedValueJSON: profileValue,
		Confidence:          caseFile.Confidence,
		ReviewStatus:        model.ReviewStatusPending,
		ExtractorType:       "system",
	})
	if len(slices) > 0 {
		service.reportingRepository.CreateFactSourceRef(model.FactSourceRef{
			FactID:     fact.ID,
			FileID:     caseFile.FileID,
			VersionNo:  parsed.Version.VersionNo,
			SliceID:    slices[0].ID,
			PageNo:     slices[0].PageStart,
			BBoxJSON:   slices[0].BBox,
			QuoteText:  parsed.Version.OriginName,
			SourceRank: 1,
			IsPrimary:  true,
		})
	}
}

func (service *reportingService) createSliceFacts(reportCase model.ReportCase, caseFile model.ReportCaseFile, parsed ParsedDocument, slices []model.DocumentSliceDTO, operatorID int64) {
	for _, slice := range slices {
		if slice.SliceType != model.DocumentStructureParagraph && slice.SliceType != model.DocumentStructureSection {
			continue
		}
		content := strings.TrimSpace(slice.CleanText)
		if content == "" {
			continue
		}
		if len([]rune(content)) > 240 {
			content = string([]rune(content)[:240]) + "…"
		}
		value, _ := json.Marshal(map[string]any{
			"title":      slice.Title,
			"sliceType":  slice.SliceType,
			"sourceType": slice.SourceType,
			"content":    content,
		})
		fact := service.reportingRepository.CreateExtractionFact(model.ExtractionFact{
			BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
			CaseID:              reportCase.ID,
			CaseFileID:          caseFile.ID,
			FactType:            "slice_excerpt",
			FactKey:             "slice." + normalizeKey(caseFile.ManualCategory) + "." + strconvSafe(slice.ID),
			FactValueJSON:       value,
			NormalizedValueJSON: value,
			Confidence:          slice.Confidence,
			ReviewStatus:        model.ReviewStatusPending,
			ExtractorType:       parsed.Profile.SourceType,
		})
		service.reportingRepository.CreateFactSourceRef(model.FactSourceRef{
			FactID:     fact.ID,
			FileID:     caseFile.FileID,
			VersionNo:  parsed.Version.VersionNo,
			SliceID:    slice.ID,
			PageNo:     slice.PageStart,
			BBoxJSON:   slice.BBox,
			QuoteText:  content,
			SourceRank: 1,
			IsPrimary:  true,
		})
	}
}

func (service *reportingService) createTableFacts(reportCase model.ReportCase, caseFile model.ReportCaseFile, tables []model.DocumentTableDTO, cells []model.DocumentTableCellDTO, operatorID int64) {
	for _, table := range tables {
		value, _ := json.Marshal(map[string]any{
			"title":          table.Title,
			"columnCount":    table.ColumnCount,
			"headerRowCount": table.HeaderRowCount,
			"parseStatus":    table.ParseStatus,
		})
		fact := service.reportingRepository.CreateExtractionFact(model.ExtractionFact{
			BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
			CaseID:              reportCase.ID,
			CaseFileID:          caseFile.ID,
			FactType:            "table_summary",
			FactKey:             "table." + normalizeKey(caseFile.ManualCategory) + "." + strconvSafe(table.ID),
			FactValueJSON:       value,
			NormalizedValueJSON: value,
			Confidence:          0.95,
			ReviewStatus:        model.ReviewStatusPending,
			ExtractorType:       table.SourceType,
		})
		primaryCell := firstCellForTable(cells, table.ID)
		service.reportingRepository.CreateFactSourceRef(model.FactSourceRef{
			FactID:       fact.ID,
			FileID:       caseFile.FileID,
			VersionNo:    caseFile.VersionNo,
			TableID:      table.ID,
			FragmentID:   primaryCell.FragmentID,
			CellID:       primaryCell.ID,
			PageNo:       table.PageStart,
			BBoxJSON:     table.BBox,
			QuoteText:    primaryCell.RawText,
			TableCellRef: buildCellRef(primaryCell.RowIndex, primaryCell.ColIndex),
			SourceRank:   1,
			IsPrimary:    true,
		})
	}
}

func (service *reportingService) rebuildAssembly(reportCase model.ReportCase, operatorID int64) *model.APIError {
	service.reportingRepository.DeleteAssemblyItemsByCaseID(reportCase.ID)
	approvedFiles := service.reportingRepository.FindReportCaseFiles(reportCase.ID)
	sort.Slice(approvedFiles, func(i, j int) bool { return approvedFiles[i].ID < approvedFiles[j].ID })
	displayOrder := 1
	for _, caseFile := range approvedFiles {
		if caseFile.ReviewStatus != model.ReviewStatusApproved {
			continue
		}
		facts := service.reportingRepository.FindFactsByCaseFileID(caseFile.ID)
		for _, fact := range facts {
			if fact.ReviewStatus != model.ReviewStatusApproved {
				continue
			}
			snapshot, _ := json.Marshal(map[string]any{
				"manualCategory":   caseFile.ManualCategory,
				"finalSubCategory": caseFile.FinalSubCategory,
				"factKey":          fact.FactKey,
				"factValue":        json.RawMessage(fact.FactValueJSON),
				"parseStatus":      caseFile.ParseStatus,
				"sourceType":       caseFile.SourceType,
			})
			service.reportingRepository.CreateAssemblyItem(model.AssemblyItem{
				BaseEntity:        model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
				CaseID:            reportCase.ID,
				TemplateSlotKey:   caseFile.ManualCategory,
				ItemType:          "fact",
				FactID:            fact.ID,
				SubjectAssetID:    0,
				DisplayOrder:      displayOrder,
				Status:            model.AssemblyItemStatusReady,
				SnapshotValueJSON: snapshot,
			})
			displayOrder++
		}
	}
	return nil
}

func (service *reportingService) refreshCaseSummary(reportCase model.ReportCase, operatorID int64) *model.APIError {
	summaryMap := map[string]any{}
	if len(reportCase.SummaryJSON) > 0 {
		_ = json.Unmarshal(reportCase.SummaryJSON, &summaryMap)
	}
	files := service.reportingRepository.FindReportCaseFiles(reportCase.ID)
	readyCount := 0
	reviewPendingCount := 0
	needsOCRCount := 0
	for _, item := range files {
		if item.ReviewStatus == model.ReviewStatusApproved {
			readyCount++
		}
		if item.ReviewStatus == model.ReviewStatusPending {
			reviewPendingCount++
		}
		if item.OCRPending {
			needsOCRCount++
		}
	}
	summaryMap["fileCount"] = len(files)
	summaryMap["readyCount"] = readyCount
	summaryMap["reviewPendingCount"] = reviewPendingCount
	summaryMap["needsOCRCount"] = needsOCRCount
	summary, _ := json.Marshal(summaryMap)
	reportCase.SummaryJSON = summary
	reportCase.UpdatedBy = operatorID
	_, ok := service.reportingRepository.UpdateReportCase(reportCase)
	if !ok {
		return model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	return nil
}

func (service *reportingService) suggestSubCategory(category, originName string) string {
	name := strings.ToLower(strings.TrimSpace(originName))
	switch category {
	case "主体":
		if strings.Contains(name, "营业") || strings.Contains(name, "license") {
			return "证照材料"
		}
		if strings.Contains(name, "股东") || strings.Contains(name, "章程") {
			return "主体治理"
		}
		return "主体基础资料"
	case "区域":
		if strings.Contains(name, "财政") || strings.Contains(name, "预算") {
			return "区域财政材料"
		}
		return "区域基础材料"
	case "财务":
		if strings.Contains(name, "审计") {
			return "审计报告"
		}
		if strings.Contains(name, "报表") || strings.Contains(name, "balance") || strings.Contains(name, "csv") {
			return "财务报表"
		}
		return "财务基础材料"
	case "项目":
		if strings.Contains(name, "可研") {
			return "可研材料"
		}
		return "项目材料"
	case "反担保":
		return "反担保材料"
	default:
		return "待细分"
	}
}

func (service *reportingService) deriveConfidence(originName string, profile DocumentProfile) float64 {
	name := strings.TrimSpace(originName)
	if profile.OCRRequired {
		return 0.46
	}
	if name == "" {
		return 0.52
	}
	if strings.Contains(strings.ToLower(name), "audit") || strings.Contains(name, "审计") {
		return 0.93
	}
	if profile.FileType == "csv" || profile.FileType == "tsv" {
		return 0.97
	}
	if profile.FileType == "pdf" && profile.HasTextLayer {
		if profile.ParseStrategy == "pdf_decode_failed" {
			return 0.25
		}
		return 0.9
	}
	return 0.82
}

func chooseParseStatus(parsed ParsedDocument) string {
	if parsed.Profile.OCRRequired {
		return model.DocumentParseStatusNeedsOCR
	}
	if parsed.Profile.ParseStrategy == "pdf_decode_failed" {
		return model.DocumentParseStatusFailed
	}
	if len(parsed.Slices) == 0 && len(parsed.Tables) == 0 {
		return model.DocumentParseStatusFailed
	}
	allFailed := true
	for _, slice := range parsed.Slices {
		if slice.ParseStatus != model.DocumentParseStatusFailed {
			allFailed = false
			break
		}
	}
	if allFailed && len(parsed.Slices) > 0 {
		return model.DocumentParseStatusFailed
	}
	return model.DocumentParseStatusParsed
}

func reportingOCRProvider(parsed ParsedDocument) string {
	if parsed.OCRTask == nil {
		return "noop"
	}
	if strings.TrimSpace(parsed.OCRTask.ProviderUsed) != "" {
		return parsed.OCRTask.ProviderUsed
	}
	if strings.TrimSpace(parsed.OCRTask.ProviderMode) != "" {
		return parsed.OCRTask.ProviderMode
	}
	return "noop"
}

func reportingOCRTaskID(parsed ParsedDocument) int64 {
	if parsed.OCRTask == nil {
		return 0
	}
	return parsed.OCRTask.ID
}

func reportingOCRTaskStatus(parsed ParsedDocument) string {
	if parsed.OCRTask == nil {
		return ""
	}
	return parsed.OCRTask.Status
}

func normalizeJSONArray(raw json.RawMessage, fieldName string) (json.RawMessage, *model.APIError) {
	if len(raw) == 0 {
		return json.RawMessage(`[]`), nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 不是合法 JSON")
	}
	if _, ok := root.([]any); !ok {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 必须为 JSON array")
	}
	normalized, _ := json.Marshal(root)
	return normalized, nil
}

func normalizeJSONObject(raw json.RawMessage, fieldName string) (json.RawMessage, *model.APIError) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 不是合法 JSON")
	}
	if _, ok := root.(map[string]any); !ok {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 必须为 JSON object")
	}
	normalized, _ := json.Marshal(root)
	return normalized, nil
}

func parseTemplateGuidanceFromAnnotations(raw json.RawMessage) []model.TemplateCommentGuidanceItem {
	if len(raw) == 0 {
		return []model.TemplateCommentGuidanceItem{}
	}
	items := make([]model.TemplateCommentGuidanceItem, 0)
	if err := json.Unmarshal(raw, &items); err != nil {
		return []model.TemplateCommentGuidanceItem{}
	}
	out := make([]model.TemplateCommentGuidanceItem, 0, len(items))
	for _, item := range items {
		item.CommentText = strings.TrimSpace(item.CommentText)
		if item.CommentText == "" {
			continue
		}
		if strings.TrimSpace(item.SourceType) == "" {
			item.SourceType = "template_comment"
		}
		if item.AnchorIndex == 0 && strings.TrimSpace(item.AnchorText) == "" {
			item.AnchorIndex = -1
		}
		out = append(out, item)
	}
	return out
}

func parseTemplateGuidanceFromSummary(summary map[string]any) []model.TemplateCommentGuidanceItem {
	raw, ok := summary["templateCommentGuidance"]
	if !ok {
		return []model.TemplateCommentGuidanceItem{}
	}
	normalized, err := json.Marshal(raw)
	if err != nil {
		return []model.TemplateCommentGuidanceItem{}
	}
	return parseTemplateGuidanceFromAnnotations(normalized)
}

func readBoolFromMap(source map[string]any, key string) bool {
	value, exists := source[key]
	if !exists {
		return false
	}
	typed, ok := value.(bool)
	return ok && typed
}

func readIntFromMap(source map[string]any, key string) int {
	value, exists := source[key]
	if !exists {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case int64:
		return int(typed)
	default:
		return 0
	}
}

func toFactDTOs(items []model.ExtractionFact) []model.ExtractionFactDTO {
	out := make([]model.ExtractionFactDTO, 0, len(items))
	for _, item := range items {
		out = append(out, item.ToDTO())
	}
	return out
}

func toSourceRefDTOs(items []model.FactSourceRef) []model.FactSourceRefDTO {
	out := make([]model.FactSourceRefDTO, 0, len(items))
	for _, item := range items {
		out = append(out, item.ToDTO())
	}
	return out
}

func normalizeKey(raw string) string {
	replacer := strings.NewReplacer(" ", "_", "/", "_", "-", "_")
	return strings.ToLower(replacer.Replace(strings.TrimSpace(raw)))
}

func strconvSafe(value int64) string {
	return fmt.Sprintf("%d", value)
}

func buildCellRef(rowIndex, colIndex int) string {
	return fmt.Sprintf("r%d_c%d", rowIndex, colIndex)
}

func firstCellForTable(cells []model.DocumentTableCellDTO, tableID int64) model.DocumentTableCellDTO {
	for _, cell := range cells {
		if cell.TableID == tableID {
			return cell
		}
	}
	return model.DocumentTableCellDTO{}
}
