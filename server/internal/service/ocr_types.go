package service

type OCRTaskSubmitRequest struct {
	FileID        int64  `json:"fileId"`
	VersionNo     int    `json:"versionNo"`
	FileName      string `json:"fileName"`
	MimeType      string `json:"mimeType"`
	ProviderMode  string `json:"providerMode"`
	EnableTables  bool   `json:"enableTables"`
	ContentBase64 string `json:"contentBase64"`
}

type OCRTaskSubmitResponse struct {
	TaskID       string         `json:"taskId"`
	Status       string         `json:"status"`
	Provider     string         `json:"provider"`
	Progress     int            `json:"progress"`
	PageCount    int            `json:"pageCount"`
	Confidence   float64        `json:"confidence"`
	ErrorCode    string         `json:"errorCode"`
	ErrorMessage string         `json:"errorMessage"`
	Result       *OCRTaskResult `json:"result"`
}

type OCRTaskStatusResponse struct {
	TaskID       string         `json:"taskId"`
	Status       string         `json:"status"`
	Provider     string         `json:"provider"`
	Progress     int            `json:"progress"`
	PageCount    int            `json:"pageCount"`
	Confidence   float64        `json:"confidence"`
	ErrorCode    string         `json:"errorCode"`
	ErrorMessage string         `json:"errorMessage"`
	Result       *OCRTaskResult `json:"result"`
}

type OCRTaskResult struct {
	Provider   string          `json:"provider"`
	PageCount  int             `json:"pageCount"`
	Confidence float64         `json:"confidence"`
	Language   string          `json:"language"`
	Pages      []OCRResultPage `json:"pages"`
}

type OCRResultPage struct {
	PageNo int              `json:"pageNo"`
	Width  float64          `json:"width"`
	Height float64          `json:"height"`
	Text   string           `json:"text"`
	Blocks []OCRResultBlock `json:"blocks"`
	Tables []OCRResultTable `json:"tables"`
}

type OCRResultBlock struct {
	BlockNo int             `json:"blockNo"`
	BBox    []float64       `json:"bbox"`
	Text    string          `json:"text"`
	Lines   []OCRResultLine `json:"lines"`
}

type OCRResultLine struct {
	LineNo int       `json:"lineNo"`
	BBox   []float64 `json:"bbox"`
	Text   string    `json:"text"`
}

type OCRResultTable struct {
	TableNo        int             `json:"tableNo"`
	BBox           []float64       `json:"bbox"`
	HeaderRowCount int             `json:"headerRowCount"`
	Rows           [][]string      `json:"rows"`
	Cells          []OCRResultCell `json:"cells"`
}

type OCRResultCell struct {
	RowIndex   int       `json:"rowIndex"`
	ColIndex   int       `json:"colIndex"`
	RowSpan    int       `json:"rowSpan"`
	ColSpan    int       `json:"colSpan"`
	Text       string    `json:"text"`
	BBox       []float64 `json:"bbox"`
	Confidence float64   `json:"confidence"`
}
