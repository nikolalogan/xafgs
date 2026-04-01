package apimeta

type ParamLocation string

const (
	ParamLocationPath  ParamLocation = "path"
	ParamLocationQuery ParamLocation = "query"
	ParamLocationBody  ParamLocation = "body"
)

type FieldValidation struct {
	Required bool     `json:"required"`
	Enum     []string `json:"enum,omitempty"`
	Min      *int64   `json:"min,omitempty"`
	Max      *int64   `json:"max,omitempty"`
	Pattern  string   `json:"pattern,omitempty"`
}

type APIField struct {
	Name        string          `json:"name"`
	In          ParamLocation   `json:"in"`
	Type        string          `json:"type"`
	Description string          `json:"description,omitempty"`
	Validation  FieldValidation `json:"validation"`
}

type APIResponseSchema struct {
	HTTPStatus  int    `json:"httpStatus"`
	Code        string `json:"code"`
	ContentType string `json:"contentType,omitempty"`
	Description string `json:"description,omitempty"`
	DataShape   string `json:"dataShape,omitempty"`
	Example     any    `json:"example,omitempty"`
}

type APIRouteDoc struct {
	Method      string              `json:"method"`
	Path        string              `json:"path"`
	Summary     string              `json:"summary,omitempty"`
	Auth        string              `json:"auth,omitempty"`
	Params      []APIField           `json:"params,omitempty"`
	Responses   []APIResponseSchema  `json:"responses,omitempty"`
	LastTraces  []Trace             `json:"lastTraces,omitempty"`
	SourceHints map[string]string   `json:"sourceHints,omitempty"`
}
