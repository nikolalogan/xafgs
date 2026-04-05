package handler

import (
	"encoding/json"
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type workflowNodeGenerateRequest struct {
	Model       string `json:"model"`
	NodeType    string `json:"nodeType" validate:"required"`
	Description string `json:"description" validate:"required"`
	Context     struct {
		ActiveNodeType string `json:"activeNodeType"`
		SelectedAPI    *struct {
			Method    string `json:"method"`
			Path      string `json:"path"`
			Summary   string `json:"summary"`
			Auth      string `json:"auth"`
			Params    []struct {
				Name        string `json:"name"`
				In          string `json:"in"`
				Type        string `json:"type"`
				Description string `json:"description"`
				Validation  struct {
					Required bool     `json:"required"`
					Enum     []string `json:"enum"`
					Min      *float64 `json:"min"`
					Max      *float64 `json:"max"`
					Pattern  string   `json:"pattern"`
				} `json:"validation"`
			} `json:"params"`
			Responses []struct {
				HTTPStatus  int             `json:"httpStatus"`
				Code        string          `json:"code"`
				ContentType string          `json:"contentType"`
				Description string          `json:"description"`
				DataShape   string          `json:"dataShape"`
				Example     json.RawMessage `json:"example"`
			} `json:"responses"`
		} `json:"selectedAPI"`
	} `json:"context"`
}

type WorkflowNodeGenerateHandler struct {
	service  service.WorkflowNodeGenerateService
	registry *apimeta.Registry
}

func NewWorkflowNodeGenerateHandler(service service.WorkflowNodeGenerateService, registry *apimeta.Registry) *WorkflowNodeGenerateHandler {
	return &WorkflowNodeGenerateHandler{service: service, registry: registry}
}

func (handler *WorkflowNodeGenerateHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[workflowNodeGenerateRequest]{
		Method:             fiber.MethodPost,
		Path:               "/workflow/node-generate",
		Summary:            "工作流节点 AI 生成",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[service.WorkflowNodeGenerateResult](),
	}, handler.Generate)
}

func (handler *WorkflowNodeGenerateHandler) Generate(c *fiber.Ctx, request *workflowNodeGenerateRequest) error {
	userID, ok := c.Locals(middleware.LocalAuthUserID).(int64)
	if !ok || userID <= 0 {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "未找到认证用户")
	}

	serviceRequest := service.WorkflowNodeGenerateRequest{
		Model:       strings.TrimSpace(request.Model),
		NodeType:    strings.TrimSpace(request.NodeType),
		Description: strings.TrimSpace(request.Description),
		Context: service.WorkflowNodeGenerateContext{
			ActiveNodeType: strings.TrimSpace(request.Context.ActiveNodeType),
		},
	}
	if request.Context.SelectedAPI != nil {
		selectedAPI := &service.WorkflowNodeGenerateSelectedAPI{
			Method:  strings.TrimSpace(request.Context.SelectedAPI.Method),
			Path:    strings.TrimSpace(request.Context.SelectedAPI.Path),
			Summary: strings.TrimSpace(request.Context.SelectedAPI.Summary),
			Auth:    strings.TrimSpace(request.Context.SelectedAPI.Auth),
		}
		if len(request.Context.SelectedAPI.Params) > 0 {
			selectedAPI.Params = make([]service.WorkflowNodeGenerateAPIParam, 0, len(request.Context.SelectedAPI.Params))
			for _, param := range request.Context.SelectedAPI.Params {
				selectedAPI.Params = append(selectedAPI.Params, service.WorkflowNodeGenerateAPIParam{
					Name:        strings.TrimSpace(param.Name),
					In:          strings.TrimSpace(param.In),
					Type:        strings.TrimSpace(param.Type),
					Description: strings.TrimSpace(param.Description),
					Validation: service.WorkflowNodeGenerateAPIParamValidation{
						Required: param.Validation.Required,
						Enum:     param.Validation.Enum,
						Min:      param.Validation.Min,
						Max:      param.Validation.Max,
						Pattern:  strings.TrimSpace(param.Validation.Pattern),
					},
				})
			}
		}
		if len(request.Context.SelectedAPI.Responses) > 0 {
			selectedAPI.Responses = make([]service.WorkflowNodeGenerateAPIResponse, 0, len(request.Context.SelectedAPI.Responses))
			for _, apiResponse := range request.Context.SelectedAPI.Responses {
				selectedAPI.Responses = append(selectedAPI.Responses, service.WorkflowNodeGenerateAPIResponse{
					HTTPStatus:  apiResponse.HTTPStatus,
					Code:        strings.TrimSpace(apiResponse.Code),
					ContentType: strings.TrimSpace(apiResponse.ContentType),
					Description: strings.TrimSpace(apiResponse.Description),
					DataShape:   strings.TrimSpace(apiResponse.DataShape),
					Example:     append(json.RawMessage(nil), apiResponse.Example...),
				})
			}
		}
		serviceRequest.Context.SelectedAPI = selectedAPI
	}

	data, apiError := handler.service.Generate(c.UserContext(), userID, serviceRequest)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}

	return response.Success(c, fiber.StatusOK, data, "生成成功")
}
