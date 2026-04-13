package handler

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/apimeta"
	"sxfgssever/server/internal/middleware"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

type createUploadSessionRequest struct {
	BizKey string `json:"bizKey"`
	FileID int64  `json:"fileId"`
}

type uploadSessionIDPathRequest struct {
	SessionID string `path:"sessionId" validate:"required"`
}

type fileIDPathRequest struct {
	FileID int64 `path:"fileId" validate:"required,min=1"`
}

type fileVersionResolveRequest struct {
	FileID    int64 `path:"fileId" validate:"required,min=1"`
	VersionNo int   `query:"versionNo"`
}

type FileHandler struct {
	fileService          service.FileService
	documentParseService service.DocumentParseService
	registry             *apimeta.Registry
}

func NewFileHandler(fileService service.FileService, documentParseService service.DocumentParseService, registry *apimeta.Registry) *FileHandler {
	return &FileHandler{
		fileService:          fileService,
		documentParseService: documentParseService,
		registry:             registry,
	}
}

func (handler *FileHandler) Register(router fiber.Router) {
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[struct{}]{
		Method:             fiber.MethodGet,
		Path:               "/files",
		Summary:            "获取文件列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.FileDTO](),
	}, handler.ListFiles)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[createUploadSessionRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/sessions",
		Summary:            "创建上传会话（选中文件但未上传）",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.UploadSessionDTO](),
	}, handler.CreateSession)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[uploadSessionIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/sessions/:sessionId/content",
		Summary:            "按会话上传文件内容",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileUploadResultDTO](),
	}, handler.UploadSessionContent)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[uploadSessionIDPathRequest]{
		Method:             fiber.MethodDelete,
		Path:               "/files/sessions/:sessionId",
		Summary:            "取消上传会话",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[bool](),
	}, handler.CancelSession)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/:fileId/versions",
		Summary:            "上传文件新版本",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileUploadResultDTO](),
	}, handler.UploadVersion)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId",
		Summary:            "获取文件详情",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileDTO](),
	}, handler.GetFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileIDPathRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId/versions",
		Summary:            "获取文件版本列表",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[[]model.FileVersionDTO](),
	}, handler.ListVersions)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:             fiber.MethodGet,
		Path:               "/files/:fileId/resolve",
		Summary:            "按 fileId/versionNo 解析已上传文件版本",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileVersionDTO](),
	}, handler.ResolveReference)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:             fiber.MethodPost,
		Path:               "/files/:fileId/parse",
		Summary:            "按 fileId/versionNo 触发单文件解析预览",
		Auth:               "auth",
		SuccessDataExample: apimeta.ExampleFromType[model.FileParseResultDTO](),
	}, handler.ParseFile)
	apimeta.Register(router, handler.registry, apimeta.RouteSpec[fileVersionResolveRequest]{
		Method:  fiber.MethodGet,
		Path:    "/files/:fileId/download",
		Summary: "按 fileId/versionNo 下载已上传文件版本",
		Auth:    "auth",
	}, handler.DownloadReference)
}

func (handler *FileHandler) ListFiles(c *fiber.Ctx, _ *struct{}) error {
	files, apiError := handler.fileService.ListFiles(c.UserContext())
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, files, "获取文件列表成功")
}

func (handler *FileHandler) CreateSession(c *fiber.Ctx, request *createUploadSessionRequest) error {
	operatorID := authUserID(c)
	request.BizKey = strings.TrimSpace(request.BizKey)

	session, apiError := handler.fileService.CreateSession(c.UserContext(), operatorID, model.CreateUploadSessionRequest{
		BizKey: request.BizKey,
		FileID: request.FileID,
	})
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusCreated, session, "创建上传会话成功")
}

func (handler *FileHandler) UploadSessionContent(c *fiber.Ctx, request *uploadSessionIDPathRequest) error {
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少上传文件，请使用 file 字段")
	}
	operatorID := authUserID(c)
	result, apiError := handler.fileService.UploadBySession(c.UserContext(), operatorID, request.SessionID, fileHeader)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "上传文件成功")
}

func (handler *FileHandler) CancelSession(c *fiber.Ctx, request *uploadSessionIDPathRequest) error {
	operatorID := authUserID(c)
	apiError := handler.fileService.CancelSession(c.UserContext(), operatorID, request.SessionID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, true, "取消上传会话成功")
}

func (handler *FileHandler) UploadVersion(c *fiber.Ctx, request *fileIDPathRequest) error {
	fileHeader, err := c.FormFile("file")
	if err != nil || fileHeader == nil {
		return response.Error(c, fiber.StatusBadRequest, response.CodeBadRequest, "缺少上传文件，请使用 file 字段")
	}
	operatorID := authUserID(c)
	result, apiError := handler.fileService.UploadVersion(c.UserContext(), operatorID, request.FileID, fileHeader)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, result, "上传版本成功")
}

func (handler *FileHandler) GetFile(c *fiber.Ctx, request *fileIDPathRequest) error {
	fileDTO, apiError := handler.fileService.GetFile(c.UserContext(), request.FileID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, fileDTO, "获取文件成功")
}

func (handler *FileHandler) ListVersions(c *fiber.Ctx, request *fileIDPathRequest) error {
	versions, apiError := handler.fileService.ListVersions(c.UserContext(), request.FileID)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, versions, "获取文件版本成功")
}

func (handler *FileHandler) ResolveReference(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	version, apiError := handler.fileService.ResolveReference(c.UserContext(), request.FileID, request.VersionNo)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, version, "解析文件引用成功")
}

func (handler *FileHandler) ParseFile(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	caseFile := model.ReportCaseFile{
		FileID:    request.FileID,
		VersionNo: request.VersionNo,
	}
	parsed, apiError := handler.documentParseService.ParseCaseFile(c.UserContext(), caseFile)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	return response.Success(c, fiber.StatusOK, buildFileParseResultDTO(parsed), "触发文件解析成功")
}

func (handler *FileHandler) DownloadReference(c *fiber.Ctx, request *fileVersionResolveRequest) error {
	version, raw, apiError := handler.fileService.ReadReferenceContent(c.UserContext(), request.FileID, request.VersionNo, 0)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}
	c.Set(fiber.HeaderContentType, version.MimeType)
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf(`attachment; filename="%s"`, sanitizeDownloadFileName(version.OriginName)))
	return c.Status(fiber.StatusOK).Send(raw)
}

func sanitizeDownloadFileName(name string) string {
	cleaned := strings.NewReplacer("\r", "_", "\n", "_", `"`, "_").Replace(strings.TrimSpace(name))
	if cleaned == "" {
		return "attachment.bin"
	}
	return cleaned
}

func authUserID(c *fiber.Ctx) int64 {
	value := c.Locals(middleware.LocalAuthUserID)
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case uint:
		return int64(typed)
	case uint64:
		return int64(typed)
	default:
		return 0
	}
}

func buildFileParseResultDTO(parsed service.ParsedDocument) model.FileParseResultDTO {
	profileJSON, _ := json.Marshal(parsed.Profile)
	return model.FileParseResultDTO{
		Version:       parsed.Version,
		Profile:       profileJSON,
		SliceCount:    len(parsed.Slices),
		TableCount:    len(parsed.Tables),
		FigureCount:   len(parsed.Figures),
		FragmentCount: len(parsed.TableFragments),
		CellCount:     len(parsed.TableCells),
		Slices:        buildSlicePreviews(parsed.Slices),
		Tables:        buildTablePreviews(parsed.Tables, parsed.TableCells),
		Figures:       buildFigurePreviews(parsed.Figures),
	}
}

func buildSlicePreviews(slices []model.DocumentSlice) []model.FileParseSlicePreviewDTO {
	previews := make([]model.FileParseSlicePreviewDTO, 0, len(slices))
	for _, slice := range slices {
		previews = append(previews, model.FileParseSlicePreviewDTO{
			SliceType:   slice.SliceType,
			Title:       slice.Title,
			PageStart:   slice.PageStart,
			PageEnd:     slice.PageEnd,
			SourceRef:   formatBBoxSourceRef(slice.BBoxJSON, slice.PageStart, slice.PageEnd),
			BBox:        slice.BBoxJSON,
			CleanText:   truncateText(slice.CleanText, 180),
			Confidence:  slice.Confidence,
			ParseStatus: slice.ParseStatus,
		})
	}
	return previews
}

func buildTablePreviews(tables []model.DocumentTable, cells []model.DocumentTableCell) []model.FileParseTablePreviewDTO {
	cellsByTable := make(map[int64][]model.DocumentTableCell)
	for _, cell := range cells {
		cellsByTable[cell.TableID] = append(cellsByTable[cell.TableID], cell)
	}
	previews := make([]model.FileParseTablePreviewDTO, 0, len(tables))
	for _, table := range tables {
		previews = append(previews, model.FileParseTablePreviewDTO{
			Title:          table.Title,
			PageStart:      table.PageStart,
			PageEnd:        table.PageEnd,
			HeaderRowCount: table.HeaderRowCount,
			ColumnCount:    table.ColumnCount,
			SourceRef:      formatBBoxSourceRef(table.BBoxJSON, table.PageStart, table.PageEnd),
			BBox:           table.BBoxJSON,
			PreviewRows:    buildTableRowPreviews(cellsByTable[table.ID]),
		})
	}
	return previews
}

func buildTableRowPreviews(cells []model.DocumentTableCell) []model.FileParseTableRowPreviewDTO {
	if len(cells) == 0 {
		return nil
	}
	sort.Slice(cells, func(i, j int) bool {
		if cells[i].RowIndex != cells[j].RowIndex {
			return cells[i].RowIndex < cells[j].RowIndex
		}
		return cells[i].ColIndex < cells[j].ColIndex
	})
	rowMap := make(map[int][]model.FileParseTableCellPreviewDTO)
	rowOrder := make([]int, 0)
	for _, cell := range cells {
		if len(rowOrder) >= 5 && rowMap[cell.RowIndex] == nil {
			continue
		}
		if _, exists := rowMap[cell.RowIndex]; !exists {
			rowOrder = append(rowOrder, cell.RowIndex)
		}
		if len(rowMap[cell.RowIndex]) >= 8 {
			continue
		}
		rowMap[cell.RowIndex] = append(rowMap[cell.RowIndex], model.FileParseTableCellPreviewDTO{
			Text:      truncateText(cell.NormalizedValue, 40),
			SourceRef: formatCellSourceRef(cell),
		})
	}
	sort.Ints(rowOrder)
	previews := make([]model.FileParseTableRowPreviewDTO, 0, len(rowOrder))
	for _, rowIndex := range rowOrder {
		previews = append(previews, model.FileParseTableRowPreviewDTO{
			RowIndex: rowIndex + 1,
			Cells:    rowMap[rowIndex],
		})
	}
	return previews
}

func buildFigurePreviews(figures []model.DocumentFigureCandidate) []model.FileParseFigurePreviewDTO {
	previews := make([]model.FileParseFigurePreviewDTO, 0, len(figures))
	for _, figure := range figures {
		previews = append(previews, model.FileParseFigurePreviewDTO{
			Title:       figure.Title,
			FigureType:  figure.FigureType,
			PageNo:      figure.PageNo,
			SourceRef:   formatBBoxSourceRef(figure.BBoxJSON, figure.PageNo, figure.PageNo),
			BBox:        figure.BBoxJSON,
			CleanText:   truncateText(figure.CleanText, 180),
			Regions:     buildFigureRegionPreviews(figure.DetailJSON),
			Confidence:  figure.Confidence,
			ParseStatus: figure.ParseStatus,
		})
	}
	return previews
}

func buildFigureRegionPreviews(detailJSON json.RawMessage) []model.FileParseFigureRegionPreviewDTO {
	type detailNode struct {
		RowIndex  int             `json:"rowIndex"`
		Region    string          `json:"region"`
		Text      string          `json:"text"`
		SourceRef string          `json:"sourceRef"`
		BBox      json.RawMessage `json:"bbox"`
	}
	type detailPayload struct {
		Nodes []detailNode `json:"nodes"`
	}
	var payload detailPayload
	if len(detailJSON) == 0 || json.Unmarshal(detailJSON, &payload) != nil || len(payload.Nodes) == 0 {
		return nil
	}
	previews := make([]model.FileParseFigureRegionPreviewDTO, 0, len(payload.Nodes))
	for _, node := range payload.Nodes {
		previews = append(previews, model.FileParseFigureRegionPreviewDTO{
			RowIndex:  node.RowIndex,
			Region:    node.Region,
			Text:      truncateText(node.Text, 80),
			SourceRef: node.SourceRef,
			BBox:      node.BBox,
		})
	}
	return previews
}

func formatBBoxSourceRef(bbox json.RawMessage, pageStart int, pageEnd int) string {
	var payload map[string]any
	if len(bbox) > 0 && json.Unmarshal(bbox, &payload) == nil {
		pageNo := toInt(payload["page"])
		block := toInt(payload["block"])
		if pageNo > 0 && block > 0 {
			return fmt.Sprintf("第%d页/块%d", pageNo, block)
		}
		if pageNo > 0 {
			return fmt.Sprintf("第%d页", pageNo)
		}
	}
	if pageStart > 0 && pageStart == pageEnd {
		return fmt.Sprintf("第%d页", pageStart)
	}
	if pageStart > 0 && pageEnd >= pageStart {
		return fmt.Sprintf("第%d-%d页", pageStart, pageEnd)
	}
	return "-"
}

func formatCellSourceRef(cell model.DocumentTableCell) string {
	var payload map[string]any
	if len(cell.BBoxJSON) > 0 && json.Unmarshal(cell.BBoxJSON, &payload) == nil {
		ref := strings.TrimSpace(fmt.Sprintf("%v", payload["ref"]))
		if sourceRef := formatPDFCellRef(ref); sourceRef != "" {
			return sourceRef
		}
	}
	return fmt.Sprintf("单元格R%dC%d", cell.RowIndex+1, cell.ColIndex+1)
}

func formatPDFCellRef(ref string) string {
	if ref == "" {
		return ""
	}
	parts := strings.Split(ref, "!")
	if len(parts) != 2 {
		return ""
	}
	prefix := parts[0]
	address := parts[1]
	pageNo := parseTaggedInt(prefix, "#p")
	blockIndex := parseTaggedInt(prefix, "#b")
	rowNo, colNo, ok := parseExcelAddress(address)
	if !ok {
		return ""
	}
	if pageNo > 0 && blockIndex > 0 {
		return fmt.Sprintf("第%d页/块%d/单元格R%dC%d", pageNo, blockIndex, rowNo, colNo)
	}
	return fmt.Sprintf("单元格R%dC%d", rowNo, colNo)
}

func parseTaggedInt(value string, tag string) int {
	start := strings.Index(value, tag)
	if start < 0 {
		return 0
	}
	start += len(tag)
	end := start
	for end < len(value) && value[end] >= '0' && value[end] <= '9' {
		end++
	}
	number, _ := strconv.Atoi(value[start:end])
	return number
}

func parseExcelAddress(value string) (int, int, bool) {
	value = strings.TrimSpace(strings.ToUpper(value))
	if value == "" {
		return 0, 0, false
	}
	lettersEnd := 0
	for lettersEnd < len(value) && value[lettersEnd] >= 'A' && value[lettersEnd] <= 'Z' {
		lettersEnd++
	}
	if lettersEnd == 0 || lettersEnd == len(value) {
		return 0, 0, false
	}
	rowNo, err := strconv.Atoi(value[lettersEnd:])
	if err != nil || rowNo <= 0 {
		return 0, 0, false
	}
	colNo := 0
	for _, ch := range value[:lettersEnd] {
		colNo = colNo*26 + int(ch-'A'+1)
	}
	if colNo <= 0 {
		return 0, 0, false
	}
	return rowNo, colNo, true
}

func toInt(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		number, _ := strconv.Atoi(strings.TrimSpace(typed))
		return number
	default:
		return 0
	}
}

func truncateText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len([]rune(value)) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "…"
}
