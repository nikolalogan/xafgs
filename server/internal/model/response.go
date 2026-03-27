package model

type APIResponse struct {
	StatusCode int    `json:"statusCode"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	Data       any    `json:"data,omitempty"`
	RequestID  string `json:"requestId"`
	Timestamp  string `json:"timestamp"`
}

type APIError struct {
	HTTPStatus int
	Code       string
	Message    string
}

func (apiError *APIError) Error() string {
	return apiError.Message
}

func NewAPIError(httpStatus int, code, message string) *APIError {
	return &APIError{
		HTTPStatus: httpStatus,
		Code:       code,
		Message:    message,
	}
}
