package handler

import (
	"net/http"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type OCRPreviewHandler struct {
	service  service.TableRepairPreviewService
	registry *apimeta.Registry
}

type OCRTableRepairPreviewRequest struct {
	Model                            string   `json:"model"`
	File                             string   `json:"file" validate:"required"`
	FileType                         *int     `json:"fileType"`
	Visualize                        *bool    `json:"visualize"`
	LogID                            string   `json:"logId"`
	UseDocOrientationClassify        *bool    `json:"useDocOrientationClassify"`
	UseDocUnwarping                  *bool    `json:"useDocUnwarping"`
	UseTextlineOrientation           *bool    `json:"useTextlineOrientation"`
	UseSealRecognition               *bool    `json:"useSealRecognition"`
	UseTableRecognition              *bool    `json:"useTableRecognition"`
	UseFormulaRecognition            *bool    `json:"useFormulaRecognition"`
	UseChartRecognition              *bool    `json:"useChartRecognition"`
	UseRegionDetection               *bool    `json:"useRegionDetection"`
	FormatBlockContent               *bool    `json:"formatBlockContent"`
	LayoutNms                        *bool    `json:"layoutNms"`
	LayoutThreshold                  *float64 `json:"layoutThreshold"`
	LayoutUnclipRatio                *float64 `json:"layoutUnclipRatio"`
	LayoutMergeBboxesMode            string   `json:"layoutMergeBboxesMode"`
	TextDetLimitSideLen              *int     `json:"textDetLimitSideLen"`
	TextDetLimitType                 string   `json:"textDetLimitType"`
	TextDetThresh                    *float64 `json:"textDetThresh"`
	TextDetBoxThresh                 *float64 `json:"textDetBoxThresh"`
	TextDetUnclipRatio               *float64 `json:"textDetUnclipRatio"`
	TextRecScoreThresh               *float64 `json:"textRecScoreThresh"`
	SealDetLimitSideLen              *int     `json:"sealDetLimitSideLen"`
	SealDetLimitType                 string   `json:"sealDetLimitType"`
	SealDetThresh                    *float64 `json:"sealDetThresh"`
	SealDetBoxThresh                 *float64 `json:"sealDetBoxThresh"`
	SealDetUnclipRatio               *float64 `json:"sealDetUnclipRatio"`
	SealRecScoreThresh               *float64 `json:"sealRecScoreThresh"`
	UseWiredTableCellsTransToHtml    *bool    `json:"useWiredTableCellsTransToHtml"`
	UseWirelessTableCellsTransToHtml *bool    `json:"useWirelessTableCellsTransToHtml"`
	UseTableOrientationClassify      *bool    `json:"useTableOrientationClassify"`
	UseOcrResultsWithTableCells      *bool    `json:"useOcrResultsWithTableCells"`
	UseE2eWiredTableRecModel         *bool    `json:"useE2eWiredTableRecModel"`
	UseE2eWirelessTableRecModel      *bool    `json:"useE2eWirelessTableRecModel"`
	MarkdownIgnoreLabels             []string `json:"markdownIgnoreLabels"`
	PrettifyMarkdown                 *bool    `json:"prettifyMarkdown"`
	ShowFormulaNumber                *bool    `json:"showFormulaNumber"`
}

func NewOCRPreviewHandler(service service.TableRepairPreviewService, registry *apimeta.Registry) *OCRPreviewHandler {
	return &OCRPreviewHandler{
		service:  service,
		registry: registry,
	}
}

func (handler *OCRPreviewHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[OCRTableRepairPreviewRequest]{
		Method:             fiber.MethodPost,
		Path:               "/ocr/table-repair-preview",
		Summary:            "GLM OCR 文档解析预览",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[map[string]any](),
	}, handler.TableRepairPreview)
}

func (handler *OCRPreviewHandler) TableRepairPreview(c *fiber.Ctx, _ *OCRTableRepairPreviewRequest) error {
	payload := map[string]any{}
	if err := c.BodyParser(&payload); err != nil {
		return response.Error(c, http.StatusBadRequest, response.CodeBadRequest, "请求体格式错误")
	}
	data, apiError := handler.service.ParseAndRepair(c.UserContext(), payload)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, http.StatusOK, data, "解析成功")
}
