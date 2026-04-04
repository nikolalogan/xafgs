package model

type CreateUploadSessionRequest struct {
	BizKey string `json:"bizKey"`
	FileID int64  `json:"fileId"`
}
