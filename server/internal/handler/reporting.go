package handler

import (
	"encoding/json"
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

type reportCaseIDPathRequest struct {
	CaseID int64 `path:"caseId" validate:"required,min=1"`
}

type subjectIDPathRequest struct {
	SubjectID int64 `path:"subjectId" validate:"required,min=1"`
}

type createReportTemplateRequest struct {
	TemplateKey          string          `json:"templateKey" validate:"required"`
	Name                 string          `json:"name" validate:"required"`
	Description          string          `json:"description"`
	Status               string          `json:"status"`
	CategoriesJSON       json.RawMessage `json:"categoriesJson"`
	ProcessingConfigJSON json.RawMessage `json:"processingConfigJson"`
}

type updateReportTemplateRequest struct {
	TemplateID           int64           `path:"templateId" validate:"required,min=1"`
	Name                 string          `json:"name" validate:"required"`
	Description          string          `json:"description"`
	Status               string          `json:"status"`
	CategoriesJSON       json.RawMessage `json:"categoriesJson"`
	ProcessingConfigJSON json.RawMessage `json:"processingConfigJson"`
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

type reviewReportCaseDecision struct {
	CaseFileID       int64  `json:"caseFileId" validate:"required,min=1"`
	Decision         string `json:"decision" validate:"required"`
	FinalSubCategory string `json:"finalSubCategory"`
}

type reviewReportCaseRequest struct {
	Decisions []reviewReportCaseDecision `json:"decisions" validate:"required,min=1,dive"`
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

	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/report-cases",
		Summary:            "获取报告实例列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.ReportCaseDTO](),
	}, handler.ListReportCases)
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
	result, apiError := handler.reportingService.ListReportTemplates(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取报告模板列表成功")
}

func (handler *ReportingHandler) GetReportTemplate(c *fiber.Ctx, request *reportTemplateIDPathRequest) error {
	result, apiError := handler.reportingService.GetReportTemplate(c.UserContext(), request.TemplateID)
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
	}, operatorID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "更新报告模板成功")
}

func (handler *ReportingHandler) ListReportCases(c *fiber.Ctx, _ *struct{}) error {
	result, apiError := handler.reportingService.ListReportCases(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "获取报告实例列表成功")
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
