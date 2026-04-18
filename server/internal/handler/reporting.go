package handler

import (
	"encoding/json"
	"io"
	"mime/multipart"
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type reportTemplateIDPathRequest struct {
	TemplateID int64 `path:"templateId" validate:"required,min=1"`
}

type reportTemplateAIAssistRequest struct {
	TemplateID   int64  `path:"templateId" validate:"required,min=1"`
	Mode         string `json:"mode"`
	Instruction  string `json:"instruction"`
	SelectedText string `json:"selectedText"`
	FullMarkdown string `json:"fullMarkdown"`
	Model        string `json:"model"`
}

type reportCaseIDPathRequest struct {
	CaseID int64 `path:"caseId" validate:"required,min=1"`
}

type subjectIDPathRequest struct {
	SubjectID int64 `path:"subjectId" validate:"required,min=1"`
}

type enterpriseProjectIDPathRequest struct {
	ProjectID int64 `path:"projectId" validate:"required,min=1"`
}

type enterpriseProjectFileTerminatePathRequest struct {
	ProjectID  int64 `path:"projectId" validate:"required,min=1"`
	CaseFileID int64 `path:"caseFileId" validate:"required,min=1"`
}

type enterpriseProjectFileManualAdjustPathRequest struct {
	ProjectID  int64 `path:"projectId" validate:"required,min=1"`
	CaseFileID int64 `path:"caseFileId" validate:"required,min=1"`
}

type enterpriseProjectFileManualAdjustRequest struct {
	FinalSubCategory string `json:"finalSubCategory"`
}

type enterpriseProjectFileBlockPathRequest struct {
	ProjectID  int64 `path:"projectId" validate:"required,min=1"`
	CaseFileID int64 `path:"caseFileId" validate:"required,min=1"`
}

type enterpriseProjectFileBlockUpdatePathRequest struct {
	ProjectID  int64 `path:"projectId" validate:"required,min=1"`
	CaseFileID int64 `path:"caseFileId" validate:"required,min=1"`
	BlockID    int64 `path:"blockId" validate:"required,min=1"`
}

type enterpriseProjectFileBlockUpdateRequest struct {
	CurrentHTML string `json:"currentHtml"`
}

type listEnterpriseProjectsRequest struct {
	EnterpriseID int64 `query:"enterpriseId"`
}

type createReportTemplateRequest struct {
	TemplateKey          string          `json:"templateKey" validate:"required"`
	Name                 string          `json:"name" validate:"required"`
	Description          string          `json:"description"`
	Status               string          `json:"status"`
	CategoriesJSON       json.RawMessage `json:"categoriesJson"`
	ProcessingConfigJSON json.RawMessage `json:"processingConfigJson"`
	ContentMarkdown      string          `json:"contentMarkdown"`
	EditorConfigJSON     json.RawMessage `json:"editorConfigJson"`
	AnnotationsJSON      json.RawMessage `json:"annotationsJson"`
}

type updateReportTemplateRequest struct {
	TemplateID           int64           `path:"templateId" validate:"required,min=1"`
	Name                 string          `json:"name" validate:"required"`
	Description          string          `json:"description"`
	Status               string          `json:"status"`
	CategoriesJSON       json.RawMessage `json:"categoriesJson"`
	ProcessingConfigJSON json.RawMessage `json:"processingConfigJson"`
	ContentMarkdown      string          `json:"contentMarkdown"`
	EditorConfigJSON     json.RawMessage `json:"editorConfigJson"`
	AnnotationsJSON      json.RawMessage `json:"annotationsJson"`
}

type createReportCaseRequest struct {
	TemplateID  int64  `json:"templateId" validate:"required,min=1"`
	Name        string `json:"name" validate:"required"`
	SubjectID   int64  `json:"subjectId"`
	SubjectName string `json:"subjectName"`
}

type attachReportCaseFileRequest struct {
	FileID         int64  `json:"fileId" validate:"required,min=1"`
	ManualCategory string `json:"manualCategory" validate:"required"`
}

type processReportCaseRequest struct {
	Force bool `json:"force"`
}

type reportCaseGenerationContextRequest struct {
	CaseID  int64 `path:"caseId" validate:"required,min=1"`
	Consume bool  `query:"consume"`
}

type updateReportTemplateShareUsersRequest struct {
	TemplateID int64   `path:"templateId" validate:"required,min=1"`
	UserIDs    []int64 `json:"userIds"`
}

type reviewReportCaseDecision struct {
	CaseFileID       int64  `json:"caseFileId" validate:"required,min=1"`
	Decision         string `json:"decision" validate:"required"`
	FinalSubCategory string `json:"finalSubCategory"`
}

type reviewReportCaseRequest struct {
	Decisions []reviewReportCaseDecision `json:"decisions" validate:"required,min=1,dive"`
}

type createEnterpriseProjectRequest struct {
	TemplateID int64  `json:"templateId" validate:"required,min=1"`
	Name       string `json:"name"`
}

type ReportingHandler struct {
	reportingService service.ReportingService
	registry         *apimeta.Registry
}

func NewReportingHandler(reportingService service.ReportingService, registry *apimeta.Registry) *ReportingHandler {
	return &ReportingHandler{
		reportingService: reportingService,
		registry:         registry,
	}
}

func (handler *ReportingHandler) Register(router fiber.Router, adminMiddleware fiber.Handler) {
	adminMiddlewares := []fiber.Handler{adminMiddleware}
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/report-templates",
		Summary:            "获取报告模板列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.ReportTemplateDTO](),
	}, handler.ListReportTemplates)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportTemplateIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/report-templates/:templateId",
		Summary:            "获取报告模板详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportTemplateDetailDTO](),
	}, handler.GetReportTemplate)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createReportTemplateRequest]{
		Method:             fiber.MethodPost,
		Path:               "/report-templates",
		Summary:            "创建报告模板",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.ReportTemplateDTO](),
	}, handler.CreateReportTemplate)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[updateReportTemplateRequest]{
		Method:             fiber.MethodPut,
		Path:               "/report-templates/:templateId",
		Summary:            "更新报告模板",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.ReportTemplateDTO](),
	}, handler.UpdateReportTemplate)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportTemplateIDPathRequest]{
		Method:  fiber.MethodGet,
		Path:    "/report-templates/:templateId/export-word",
		Summary: "导出报告模板 Word",
		Auth:    "auth",
	}, handler.ExportReportTemplateWord)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportTemplateAIAssistRequest]{
		Method:             fiber.MethodPost,
		Path:               "/report-templates/:templateId/ai-assist",
		Summary:            "报告模板 AI 辅助编辑",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportTemplateAIAssistResponse](),
	}, handler.ReportTemplateAIAssist)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportTemplateIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/report-templates/:templateId/share-users",
		Summary:            "获取模板共享用户",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[[]model.ReportTemplateSharedUserDTO](),
	}, handler.ListReportTemplateSharedUsers)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[updateReportTemplateShareUsersRequest]{
		Method:             fiber.MethodPut,
		Path:               "/report-templates/:templateId/share-users",
		Summary:            "更新模板共享用户",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[[]model.ReportTemplateSharedUserDTO](),
	}, handler.UpdateReportTemplateSharedUsers)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportTemplateIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/report-templates/:templateId/import-word",
		Summary:            "导入Word覆盖模板文档",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.ReportTemplateDetailDTO](),
	}, handler.ImportWordToReportTemplate)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodPost,
		Path:               "/report-templates/import-word",
		Summary:            "导入Word并生成模板大纲",
		Auth:               "admin",
		Middlewares:        adminMiddlewares,
		SuccessDataExample: apimeta.ExampleFromType[model.ReportTemplateWordImportResult](),
	}, handler.ImportReportTemplateWord)

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/report-cases",
		Summary:            "获取报告实例列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.ReportCaseDTO](),
	}, handler.ListReportCases)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createEnterpriseProjectRequest]{
		Method:             fiber.MethodPost,
		Path:               "/enterprises/:enterpriseId/projects",
		Summary:            "在企业下创建项目并关联报告实例",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectDTO](),
	}, handler.CreateEnterpriseProject)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[listEnterpriseProjectsRequest]{
		Method:             fiber.MethodGet,
		Path:               "/enterprise-projects",
		Summary:            "获取企业项目列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.EnterpriseProjectDTO](),
	}, handler.ListEnterpriseProjects)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/enterprise-projects/:projectId",
		Summary:            "获取企业项目详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectDetailDTO](),
	}, handler.GetEnterpriseProject)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/enterprise-projects/:projectId/files",
		Summary:            "上传企业项目文件并入解析队列",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.UploadEnterpriseProjectFileResultDTO](),
	}, handler.UploadEnterpriseProjectFiles)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/enterprise-projects/:projectId/confirm-vectorization",
		Summary:            "确认项目文件并触发向量入队",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectVectorConfirmResultDTO](),
	}, handler.ConfirmEnterpriseProjectVectorization)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectFileManualAdjustPathRequest]{
		Method:             fiber.MethodPatch,
		Path:               "/enterprise-projects/:projectId/files/:caseFileId/manual-adjust",
		Summary:            "保存项目文件人工调整结果",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectFileManualAdjustResultDTO](),
	}, handler.UpdateEnterpriseProjectFileManualAdjust)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectFileBlockPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/enterprise-projects/:projectId/files/:caseFileId/blocks",
		Summary:            "获取项目文件分块编辑数据",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectFileBlocksDTO](),
	}, handler.GetEnterpriseProjectFileBlocks)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectFileBlockUpdatePathRequest]{
		Method:             fiber.MethodPatch,
		Path:               "/enterprise-projects/:projectId/files/:caseFileId/blocks/:blockId",
		Summary:            "保存项目文件单个分块内容",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectFileBlockUpdateResultDTO](),
	}, handler.UpdateEnterpriseProjectFileBlock)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectFileTerminatePathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/enterprise-projects/:projectId/files/:caseFileId/terminate",
		Summary:            "终止单个企业项目文件的解析/向量处理",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectFileTerminateResultDTO](),
	}, handler.TerminateEnterpriseProjectFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectFileTerminatePathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/enterprise-projects/:projectId/files/:caseFileId",
		Summary:            "移除单个企业项目附件",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectFileRemoveResultDTO](),
	}, handler.RemoveEnterpriseProjectFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[enterpriseProjectIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/enterprise-projects/:projectId/progress",
		Summary:            "查询企业项目处理进度",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.EnterpriseProjectProgressDTO](),
	}, handler.GetEnterpriseProjectProgress)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createReportCaseRequest]{
		Method:             fiber.MethodPost,
		Path:               "/report-cases",
		Summary:            "创建报告实例",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportCaseDTO](),
	}, handler.CreateReportCase)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportCaseIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/report-cases/:caseId",
		Summary:            "获取报告实例详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportCaseDetailDTO](),
	}, handler.GetReportCase)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[attachReportCaseFileRequest]{
		Method:             fiber.MethodPost,
		Path:               "/report-cases/:caseId/files",
		Summary:            "挂接报告文件",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportCaseFileDTO](),
	}, handler.AttachReportCaseFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[processReportCaseRequest]{
		Method:             fiber.MethodPost,
		Path:               "/report-cases/:caseId/process",
		Summary:            "触发报告处理",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportCaseDetailDTO](),
	}, handler.ProcessReportCase)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportCaseGenerationContextRequest]{
		Method:             fiber.MethodGet,
		Path:               "/report-cases/:caseId/generation-context",
		Summary:            "获取报告实例生成上下文（可消费模板批注要点）",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportCaseGenerationContextDTO](),
	}, handler.GetReportCaseGenerationContext)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportCaseIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/report-cases/:caseId/review-queue",
		Summary:            "获取报告复核队列",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.ReviewQueueItemDTO](),
	}, handler.GetReviewQueue)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reviewReportCaseRequest]{
		Method:             fiber.MethodPost,
		Path:               "/report-cases/:caseId/review-decisions",
		Summary:            "提交报告复核结果",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.ReportCaseDetailDTO](),
	}, handler.ReviewReportCase)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[reportCaseIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/report-cases/:caseId/assembly",
		Summary:            "获取报告组装视图",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.AssemblyViewDTO](),
	}, handler.GetAssembly)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[subjectIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/subjects/:subjectId/assets",
		Summary:            "获取主体资产池",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.SubjectAssetDTO](),
	}, handler.ListSubjectAssets)
}

func (handler *ReportingHandler) ListReportTemplates(c *fiber.Ctx, _ *struct{}) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	operatorRole, ok := c.Locals(middleware.LocalAuthRole).(string)
	if !ok || strings.TrimSpace(operatorRole) == "" {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "无法识别用户角色")
	}
	result, apiError := handler.reportingService.ListReportTemplates(c.UserContext(), operatorID, operatorRole)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取报告模板列表成功")
}

func (handler *ReportingHandler) GetReportTemplate(c *fiber.Ctx, request *reportTemplateIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	operatorRole, ok := c.Locals(middleware.LocalAuthRole).(string)
	if !ok || strings.TrimSpace(operatorRole) == "" {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "无法识别用户角色")
	}
	result, apiError := handler.reportingService.GetReportTemplate(c.UserContext(), request.TemplateID, operatorID, operatorRole)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取报告模板成功")
}

func (handler *ReportingHandler) CreateReportTemplate(c *fiber.Ctx, request *createReportTemplateRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	request.TemplateKey = strings.TrimSpace(request.TemplateKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)
	result, apiError := handler.reportingService.CreateReportTemplate(c.UserContext(), model.CreateReportTemplateRequest{
		TemplateKey:          request.TemplateKey,
		Name:                 request.Name,
		Description:          request.Description,
		Status:               request.Status,
		CategoriesJSON:       request.CategoriesJSON,
		ProcessingConfigJSON: request.ProcessingConfigJSON,
		ContentMarkdown:      request.ContentMarkdown,
		EditorConfigJSON:     request.EditorConfigJSON,
		AnnotationsJSON:      request.AnnotationsJSON,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, result, "创建报告模板成功")
}

func (handler *ReportingHandler) UpdateReportTemplate(c *fiber.Ctx, request *updateReportTemplateRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.reportingService.UpdateReportTemplate(c.UserContext(), request.TemplateID, model.UpdateReportTemplateRequest{
		Name:                 strings.TrimSpace(request.Name),
		Description:          strings.TrimSpace(request.Description),
		Status:               strings.TrimSpace(request.Status),
		CategoriesJSON:       request.CategoriesJSON,
		ProcessingConfigJSON: request.ProcessingConfigJSON,
		ContentMarkdown:      request.ContentMarkdown,
		EditorConfigJSON:     request.EditorConfigJSON,
		AnnotationsJSON:      request.AnnotationsJSON,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "更新报告模板成功")
}

func (handler *ReportingHandler) RegisterPublic(router fiber.Router) {
	_ = router
}

func (handler *ReportingHandler) ImportReportTemplateWord(c *fiber.Ctx, _ *struct{}) error {
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请上传 Word 文件")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "读取上传文件失败")
	}
	defer func() { _ = file.Close() }()

	raw, err := io.ReadAll(file)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "读取上传文件失败")
	}
	result, apiError := handler.reportingService.ImportReportTemplateWord(c.UserContext(), fileHeader.Filename, raw)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "导入 Word 成功")
}

func (handler *ReportingHandler) ExportReportTemplateWord(c *fiber.Ctx, request *reportTemplateIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	operatorRole, ok := c.Locals(middleware.LocalAuthRole).(string)
	if !ok || strings.TrimSpace(operatorRole) == "" {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "无法识别用户角色")
	}
	fileName, raw, mimeType, apiError := handler.reportingService.ExportReportTemplateWord(c.UserContext(), request.TemplateID, operatorID, operatorRole)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", `attachment; filename="`+fileName+`"`)
	return c.Status(fiber.StatusOK).Send(raw)
}

func (handler *ReportingHandler) ReportTemplateAIAssist(c *fiber.Ctx, request *reportTemplateAIAssistRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	operatorRole, ok := c.Locals(middleware.LocalAuthRole).(string)
	if !ok || strings.TrimSpace(operatorRole) == "" {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "无法识别用户角色")
	}
	result, apiError := handler.reportingService.ReportTemplateAIAssist(c.UserContext(), request.TemplateID, operatorID, operatorRole, model.ReportTemplateAIAssistRequest{
		Mode:         strings.TrimSpace(request.Mode),
		Instruction:  strings.TrimSpace(request.Instruction),
		SelectedText: request.SelectedText,
		FullMarkdown: request.FullMarkdown,
		Model:        strings.TrimSpace(request.Model),
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "AI 处理成功")
}

func (handler *ReportingHandler) ListReportTemplateSharedUsers(c *fiber.Ctx, request *reportTemplateIDPathRequest) error {
	operatorRole, ok := c.Locals(middleware.LocalAuthRole).(string)
	if !ok || strings.TrimSpace(operatorRole) == "" {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "无法识别用户角色")
	}
	result, apiError := handler.reportingService.ListReportTemplateSharedUsers(c.UserContext(), request.TemplateID, operatorRole)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取模板共享用户成功")
}

func (handler *ReportingHandler) UpdateReportTemplateSharedUsers(c *fiber.Ctx, request *updateReportTemplateShareUsersRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	operatorRole, ok := c.Locals(middleware.LocalAuthRole).(string)
	if !ok || strings.TrimSpace(operatorRole) == "" {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "无法识别用户角色")
	}
	result, apiError := handler.reportingService.UpdateReportTemplateSharedUsers(c.UserContext(), request.TemplateID, request.UserIDs, operatorID, operatorRole)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "更新模板共享用户成功")
}

func (handler *ReportingHandler) ImportWordToReportTemplate(c *fiber.Ctx, request *reportTemplateIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请上传 Word 文件")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "读取上传文件失败")
	}
	defer func() { _ = file.Close() }()
	raw, err := io.ReadAll(file)
	if err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "读取上传文件失败")
	}
	result, apiError := handler.reportingService.ImportReportTemplateWordForTemplate(c.UserContext(), request.TemplateID, fileHeader.Filename, raw, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "导入模板 Word 成功")
}

func (handler *ReportingHandler) ListReportCases(c *fiber.Ctx, _ *struct{}) error {
	result, apiError := handler.reportingService.ListReportCases(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取报告实例列表成功")
}

func (handler *ReportingHandler) CreateEnterpriseProject(c *fiber.Ctx, request *createEnterpriseProjectRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	enterpriseID, err := c.ParamsInt("enterpriseId")
	if err != nil || enterpriseID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "enterpriseId 不合法")
	}
	result, apiError := handler.reportingService.CreateEnterpriseProject(c.UserContext(), int64(enterpriseID), model.CreateEnterpriseProjectRequest{
		TemplateID: request.TemplateID,
		Name:       strings.TrimSpace(request.Name),
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, result, "创建企业项目成功")
}

func (handler *ReportingHandler) ListEnterpriseProjects(c *fiber.Ctx, request *listEnterpriseProjectsRequest) error {
	result, apiError := handler.reportingService.ListEnterpriseProjects(c.UserContext(), request.EnterpriseID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取项目列表成功")
}

func (handler *ReportingHandler) GetEnterpriseProject(c *fiber.Ctx, request *enterpriseProjectIDPathRequest) error {
	result, apiError := handler.reportingService.GetEnterpriseProject(c.UserContext(), request.ProjectID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取项目详情成功")
}

func (handler *ReportingHandler) UploadEnterpriseProjectFiles(c *fiber.Ctx, request *enterpriseProjectIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	manualCategory := strings.TrimSpace(c.FormValue("manualCategory"))
	form, err := c.MultipartForm()
	if err != nil || form == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少上传文件")
	}
	fileHeaders := make([]*multipart.FileHeader, 0)
	if rows, ok := form.File["files"]; ok {
		fileHeaders = append(fileHeaders, rows...)
	}
	if rows, ok := form.File["file"]; ok {
		fileHeaders = append(fileHeaders, rows...)
	}
	result, apiError := handler.reportingService.UploadEnterpriseProjectFiles(c.UserContext(), request.ProjectID, manualCategory, fileHeaders, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "上传并入队成功")
}

func (handler *ReportingHandler) ConfirmEnterpriseProjectVectorization(c *fiber.Ctx, request *enterpriseProjectIDPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.reportingService.ConfirmEnterpriseProjectVectorization(c.UserContext(), request.ProjectID, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "已提交向量处理确认")
}

func (handler *ReportingHandler) UpdateEnterpriseProjectFileManualAdjust(c *fiber.Ctx, request *enterpriseProjectFileManualAdjustPathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	payload := enterpriseProjectFileManualAdjustRequest{}
	if err := c.BodyParser(&payload); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式不合法")
	}
	result, apiError := handler.reportingService.UpdateEnterpriseProjectFileManualAdjust(
		c.UserContext(),
		request.ProjectID,
		request.CaseFileID,
		strings.TrimSpace(payload.FinalSubCategory),
		operatorID,
	)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "保存人工调整成功")
}

func (handler *ReportingHandler) GetEnterpriseProjectFileBlocks(c *fiber.Ctx, request *enterpriseProjectFileBlockPathRequest) error {
	result, apiError := handler.reportingService.GetEnterpriseProjectFileBlocks(c.UserContext(), request.ProjectID, request.CaseFileID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取分块成功")
}

func (handler *ReportingHandler) UpdateEnterpriseProjectFileBlock(c *fiber.Ctx, request *enterpriseProjectFileBlockUpdatePathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	payload := enterpriseProjectFileBlockUpdateRequest{}
	if err := c.BodyParser(&payload); err != nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "请求体格式不合法")
	}
	result, apiError := handler.reportingService.UpdateEnterpriseProjectFileBlock(
		c.UserContext(),
		request.ProjectID,
		request.CaseFileID,
		request.BlockID,
		strings.TrimSpace(payload.CurrentHTML),
		operatorID,
	)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "分块保存成功")
}

func (handler *ReportingHandler) TerminateEnterpriseProjectFile(c *fiber.Ctx, request *enterpriseProjectFileTerminatePathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.reportingService.TerminateEnterpriseProjectFile(c.UserContext(), request.ProjectID, request.CaseFileID, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "终止请求已处理")
}

func (handler *ReportingHandler) RemoveEnterpriseProjectFile(c *fiber.Ctx, request *enterpriseProjectFileTerminatePathRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.reportingService.RemoveEnterpriseProjectFile(c.UserContext(), request.ProjectID, request.CaseFileID, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "项目附件已移除")
}

func (handler *ReportingHandler) GetEnterpriseProjectProgress(c *fiber.Ctx, request *enterpriseProjectIDPathRequest) error {
	result, apiError := handler.reportingService.GetEnterpriseProjectProgress(c.UserContext(), request.ProjectID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取处理进度成功")
}

func (handler *ReportingHandler) CreateReportCase(c *fiber.Ctx, request *createReportCaseRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	result, apiError := handler.reportingService.CreateReportCase(c.UserContext(), model.CreateReportCaseRequest{
		TemplateID:  request.TemplateID,
		Name:        strings.TrimSpace(request.Name),
		SubjectID:   request.SubjectID,
		SubjectName: strings.TrimSpace(request.SubjectName),
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, result, "创建报告实例成功")
}

func (handler *ReportingHandler) GetReportCase(c *fiber.Ctx, request *reportCaseIDPathRequest) error {
	result, apiError := handler.reportingService.GetReportCase(c.UserContext(), request.CaseID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取报告实例成功")
}

func (handler *ReportingHandler) AttachReportCaseFile(c *fiber.Ctx, request *attachReportCaseFileRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	caseID, err := c.ParamsInt("caseId")
	if err != nil || caseID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "caseId 不合法")
	}
	result, apiError := handler.reportingService.AttachReportCaseFile(c.UserContext(), int64(caseID), model.AttachReportCaseFileRequest{
		FileID:         request.FileID,
		ManualCategory: strings.TrimSpace(request.ManualCategory),
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, result, "挂接报告文件成功")
}

func (handler *ReportingHandler) ProcessReportCase(c *fiber.Ctx, request *processReportCaseRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	caseID, err := c.ParamsInt("caseId")
	if err != nil || caseID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "caseId 不合法")
	}
	result, apiError := handler.reportingService.ProcessReportCase(c.UserContext(), int64(caseID), model.ProcessReportCaseRequest{
		Force: request.Force,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "触发报告处理成功")
}

func (handler *ReportingHandler) GetReportCaseGenerationContext(c *fiber.Ctx, request *reportCaseGenerationContextRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	consume := request.Consume
	if strings.TrimSpace(c.Query("consume")) == "" {
		consume = true
	}
	result, apiError := handler.reportingService.GetReportCaseGenerationContext(c.UserContext(), request.CaseID, consume, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取生成上下文成功")
}

func (handler *ReportingHandler) GetReviewQueue(c *fiber.Ctx, request *reportCaseIDPathRequest) error {
	result, apiError := handler.reportingService.GetReviewQueue(c.UserContext(), request.CaseID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取复核队列成功")
}

func (handler *ReportingHandler) ReviewReportCase(c *fiber.Ctx, request *reviewReportCaseRequest) error {
	operatorID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || operatorID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}
	caseID, err := c.ParamsInt("caseId")
	if err != nil || caseID <= 0 {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "caseId 不合法")
	}
	decisions := make([]model.ReviewReportCaseDecision, 0, len(request.Decisions))
	for _, item := range request.Decisions {
		decisions = append(decisions, model.ReviewReportCaseDecision{
			CaseFileID:       item.CaseFileID,
			Decision:         strings.TrimSpace(item.Decision),
			FinalSubCategory: strings.TrimSpace(item.FinalSubCategory),
		})
	}
	result, apiError := handler.reportingService.ReviewReportCase(c.UserContext(), int64(caseID), model.ReviewReportCaseRequest{
		Decisions: decisions,
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "提交复核结果成功")
}

func (handler *ReportingHandler) GetAssembly(c *fiber.Ctx, request *reportCaseIDPathRequest) error {
	result, apiError := handler.reportingService.GetAssembly(c.UserContext(), request.CaseID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取组装视图成功")
}

func (handler *ReportingHandler) ListSubjectAssets(c *fiber.Ctx, request *subjectIDPathRequest) error {
	result, apiError := handler.reportingService.ListSubjectAssets(c.UserContext(), request.SubjectID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取主体资产成功")
}
