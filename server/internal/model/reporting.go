package model

import (
	"encoding/json"
	"time"
)

const (
	ReportTemplateStatusActive   = "active"
	ReportTemplateStatusDisabled = "disabled"
)

const (
	ReportCaseStatusDraft         = "draft"
	ReportCaseStatusProcessing    = "processing"
	ReportCaseStatusPendingReview = "pending_review"
	ReportCaseStatusReady         = "ready"
)

const (
	ReportCaseFileStatusUploaded      = "uploaded"
	ReportCaseFileStatusProcessed     = "processed"
	ReportCaseFileStatusPendingReview = "pending_review"
	ReportCaseFileStatusApproved      = "approved"
	ReportCaseFileStatusRejected      = "rejected"
)

const (
	ReviewStatusPending  = "pending"
	ReviewStatusApproved = "approved"
	ReviewStatusRejected = "rejected"
)

const (
	AssemblyItemStatusReady = "ready"
)

const (
	DocumentParseStatusPending  = "pending"
	DocumentParseStatusParsed   = "parsed"
	DocumentParseStatusNeedsOCR = "needs_ocr"
	DocumentParseStatusFailed   = "failed"
)

const (
	DocumentSourceTypeNativeText = "native_text"
	DocumentSourceTypeTextLayer  = "text_layer"
	DocumentSourceTypeOCR        = "ocr"
	DocumentSourceTypeBinary     = "binary"
)

const (
	DocumentStructurePage           = "page"
	DocumentStructureSection        = "section"
	DocumentStructureParagraph      = "paragraph"
	DocumentStructureTable          = "table"
	DocumentStructureTableCandidate = "table_candidate"
)

func IsValidReportTemplateStatus(status string) bool {
	return status == ReportTemplateStatusActive || status == ReportTemplateStatusDisabled
}

func IsValidReportCaseStatus(status string) bool {
	switch status {
	case ReportCaseStatusDraft, ReportCaseStatusProcessing, ReportCaseStatusPendingReview, ReportCaseStatusReady:
		return true
	default:
		return false
	}
}

func IsValidReportCaseFileStatus(status string) bool {
	switch status {
	case ReportCaseFileStatusUploaded, ReportCaseFileStatusProcessed, ReportCaseFileStatusPendingReview, ReportCaseFileStatusApproved, ReportCaseFileStatusRejected:
		return true
	default:
		return false
	}
}

func IsValidReviewStatus(status string) bool {
	return status == ReviewStatusPending || status == ReviewStatusApproved || status == ReviewStatusRejected
}

type ReportTemplate struct {
	BaseEntity
	TemplateKey          string          `json:"templateKey"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	Status               string          `json:"status"`
	CategoriesJSON       json.RawMessage `json:"categoriesJson"`
	ProcessingConfigJSON json.RawMessage `json:"processingConfigJson"`
}

type ReportTemplateDTO struct {
	ID          int64           `json:"id"`
	TemplateKey string          `json:"templateKey"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Status      string          `json:"status"`
	Categories  json.RawMessage `json:"categories"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

type ReportTemplateDetailDTO struct {
	ReportTemplateDTO
	ProcessingConfig json.RawMessage `json:"processingConfig"`
}

type ReportCase struct {
	BaseEntity
	TemplateID  int64           `json:"templateId"`
	Name        string          `json:"name"`
	SubjectID   int64           `json:"subjectId"`
	SubjectName string          `json:"subjectName"`
	Status      string          `json:"status"`
	SummaryJSON json.RawMessage `json:"summaryJson"`
}

type ReportCaseDTO struct {
	ID          int64           `json:"id"`
	TemplateID  int64           `json:"templateId"`
	Name        string          `json:"name"`
	SubjectID   int64           `json:"subjectId"`
	SubjectName string          `json:"subjectName"`
	Status      string          `json:"status"`
	Summary     json.RawMessage `json:"summary"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

type ReportCaseFile struct {
	BaseEntity
	CaseID               int64           `json:"caseId"`
	FileID               int64           `json:"fileId"`
	VersionNo            int             `json:"versionNo"`
	ManualCategory       string          `json:"manualCategory"`
	SuggestedSubCategory string          `json:"suggestedSubCategory"`
	FinalSubCategory     string          `json:"finalSubCategory"`
	Status               string          `json:"status"`
	ReviewStatus         string          `json:"reviewStatus"`
	Confidence           float64         `json:"confidence"`
	FileType             string          `json:"fileType"`
	SourceType           string          `json:"sourceType"`
	ParseStatus          string          `json:"parseStatus"`
	OCRPending           bool            `json:"ocrPending"`
	IsScannedSuspected   bool            `json:"isScannedSuspected"`
	ProcessingNotesJSON  json.RawMessage `json:"processingNotesJson"`
}

type ReportCaseFileDTO struct {
	ID                 int64           `json:"id"`
	CaseID             int64           `json:"caseId"`
	FileID             int64           `json:"fileId"`
	VersionNo          int             `json:"versionNo"`
	ManualCategory     string          `json:"manualCategory"`
	SuggestedSubCategory string        `json:"suggestedSubCategory"`
	FinalSubCategory   string          `json:"finalSubCategory"`
	Status             string          `json:"status"`
	ReviewStatus       string          `json:"reviewStatus"`
	Confidence         float64         `json:"confidence"`
	FileType           string          `json:"fileType"`
	SourceType         string          `json:"sourceType"`
	ParseStatus        string          `json:"parseStatus"`
	OCRPending         bool            `json:"ocrPending"`
	IsScannedSuspected bool            `json:"isScannedSuspected"`
	ProcessingNotes    json.RawMessage `json:"processingNotes"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
}

type DocumentSlice struct {
	ID            int64           `json:"id"`
	ParseJobID    int64           `json:"parseJobId"`
	ParentSliceID int64           `json:"parentSliceId"`
	CaseFileID    int64           `json:"caseFileId"`
	FileID        int64           `json:"fileId"`
	VersionNo     int             `json:"versionNo"`
	SliceType     string          `json:"sliceType"`
	SourceType    string          `json:"sourceType"`
	Title         string          `json:"title"`
	TitleLevel    int             `json:"titleLevel"`
	PageStart     int             `json:"pageStart"`
	PageEnd       int             `json:"pageEnd"`
	BBoxJSON      json.RawMessage `json:"bboxJson"`
	RawText       string          `json:"rawText"`
	CleanText     string          `json:"cleanText"`
	TableJSON     json.RawMessage `json:"tableJson"`
	Confidence    float64         `json:"confidence"`
	ParseStatus   string          `json:"parseStatus"`
	OCRPending    bool            `json:"ocrPending"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type DocumentSliceDTO struct {
	ID            int64           `json:"id"`
	ParseJobID    int64           `json:"parseJobId"`
	ParentSliceID int64           `json:"parentSliceId"`
	CaseFileID    int64           `json:"caseFileId"`
	FileID        int64           `json:"fileId"`
	VersionNo     int             `json:"versionNo"`
	SliceType     string          `json:"sliceType"`
	SourceType    string          `json:"sourceType"`
	Title         string          `json:"title"`
	TitleLevel    int             `json:"titleLevel"`
	PageStart     int             `json:"pageStart"`
	PageEnd       int             `json:"pageEnd"`
	BBox          json.RawMessage `json:"bbox"`
	RawText       string          `json:"rawText"`
	CleanText     string          `json:"cleanText"`
	Table         json.RawMessage `json:"table"`
	Confidence    float64         `json:"confidence"`
	ParseStatus   string          `json:"parseStatus"`
	OCRPending    bool            `json:"ocrPending"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type DocumentTable struct {
	ID             int64           `json:"id"`
	CaseFileID     int64           `json:"caseFileId"`
	FileID         int64           `json:"fileId"`
	VersionNo      int             `json:"versionNo"`
	Title          string          `json:"title"`
	PageStart      int             `json:"pageStart"`
	PageEnd        int             `json:"pageEnd"`
	HeaderRowCount int             `json:"headerRowCount"`
	ColumnCount    int             `json:"columnCount"`
	SourceType     string          `json:"sourceType"`
	ParseStatus    string          `json:"parseStatus"`
	IsCrossPage    bool            `json:"isCrossPage"`
	BBoxJSON       json.RawMessage `json:"bboxJson"`
	CreatedAt      time.Time       `json:"createdAt"`
}

type DocumentTableDTO struct {
	ID             int64           `json:"id"`
	CaseFileID     int64           `json:"caseFileId"`
	FileID         int64           `json:"fileId"`
	VersionNo      int             `json:"versionNo"`
	Title          string          `json:"title"`
	PageStart      int             `json:"pageStart"`
	PageEnd        int             `json:"pageEnd"`
	HeaderRowCount int             `json:"headerRowCount"`
	ColumnCount    int             `json:"columnCount"`
	SourceType     string          `json:"sourceType"`
	ParseStatus    string          `json:"parseStatus"`
	IsCrossPage    bool            `json:"isCrossPage"`
	BBox           json.RawMessage `json:"bbox"`
	CreatedAt      time.Time       `json:"createdAt"`
}

type DocumentTableFragment struct {
	ID            int64           `json:"id"`
	TableID       int64           `json:"tableId"`
	CaseFileID    int64           `json:"caseFileId"`
	PageNo        int             `json:"pageNo"`
	RowStart      int             `json:"rowStart"`
	RowEnd        int             `json:"rowEnd"`
	FragmentOrder int             `json:"fragmentOrder"`
	BBoxJSON      json.RawMessage `json:"bboxJson"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type DocumentTableFragmentDTO struct {
	ID            int64           `json:"id"`
	TableID       int64           `json:"tableId"`
	CaseFileID    int64           `json:"caseFileId"`
	PageNo        int             `json:"pageNo"`
	RowStart      int             `json:"rowStart"`
	RowEnd        int             `json:"rowEnd"`
	FragmentOrder int             `json:"fragmentOrder"`
	BBox          json.RawMessage `json:"bbox"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type DocumentTableCell struct {
	ID              int64           `json:"id"`
	TableID         int64           `json:"tableId"`
	FragmentID      int64           `json:"fragmentId"`
	CaseFileID      int64           `json:"caseFileId"`
	RowIndex        int             `json:"rowIndex"`
	ColIndex        int             `json:"colIndex"`
	RowSpan         int             `json:"rowSpan"`
	ColSpan         int             `json:"colSpan"`
	RawText         string          `json:"rawText"`
	NormalizedValue string          `json:"normalizedValue"`
	BBoxJSON        json.RawMessage `json:"bboxJson"`
	Confidence      float64         `json:"confidence"`
	CreatedAt       time.Time       `json:"createdAt"`
}

type DocumentTableCellDTO struct {
	ID              int64           `json:"id"`
	TableID         int64           `json:"tableId"`
	FragmentID      int64           `json:"fragmentId"`
	CaseFileID      int64           `json:"caseFileId"`
	RowIndex        int             `json:"rowIndex"`
	ColIndex        int             `json:"colIndex"`
	RowSpan         int             `json:"rowSpan"`
	ColSpan         int             `json:"colSpan"`
	RawText         string          `json:"rawText"`
	NormalizedValue string          `json:"normalizedValue"`
	BBox            json.RawMessage `json:"bbox"`
	Confidence      float64         `json:"confidence"`
	CreatedAt       time.Time       `json:"createdAt"`
}

type ExtractionFact struct {
	BaseEntity
	CaseID              int64           `json:"caseId"`
	CaseFileID          int64           `json:"caseFileId"`
	FactType            string          `json:"factType"`
	FactKey             string          `json:"factKey"`
	FactValueJSON       json.RawMessage `json:"factValueJson"`
	NormalizedValueJSON json.RawMessage `json:"normalizedValueJson"`
	Confidence          float64         `json:"confidence"`
	ReviewStatus        string          `json:"reviewStatus"`
	ExtractorType       string          `json:"extractorType"`
}

type ExtractionFactDTO struct {
	ID              int64           `json:"id"`
	CaseID          int64           `json:"caseId"`
	CaseFileID      int64           `json:"caseFileId"`
	FactType        string          `json:"factType"`
	FactKey         string          `json:"factKey"`
	FactValue       json.RawMessage `json:"factValue"`
	NormalizedValue json.RawMessage `json:"normalizedValue"`
	Confidence      float64         `json:"confidence"`
	ReviewStatus    string          `json:"reviewStatus"`
	ExtractorType   string          `json:"extractorType"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

type FactSourceRef struct {
	ID           int64           `json:"id"`
	FactID       int64           `json:"factId"`
	FileID       int64           `json:"fileId"`
	VersionNo    int             `json:"versionNo"`
	SliceID      int64           `json:"sliceId"`
	TableID      int64           `json:"tableId"`
	FragmentID   int64           `json:"fragmentId"`
	CellID       int64           `json:"cellId"`
	PageNo       int             `json:"pageNo"`
	BBoxJSON     json.RawMessage `json:"bboxJson"`
	QuoteText    string          `json:"quoteText"`
	TableCellRef string          `json:"tableCellRef"`
	SourceRank   int             `json:"sourceRank"`
	IsPrimary    bool            `json:"isPrimary"`
	CreatedAt    time.Time       `json:"createdAt"`
}

type FactSourceRefDTO struct {
	ID           int64           `json:"id"`
	FactID       int64           `json:"factId"`
	FileID       int64           `json:"fileId"`
	VersionNo    int             `json:"versionNo"`
	SliceID      int64           `json:"sliceId"`
	TableID      int64           `json:"tableId"`
	FragmentID   int64           `json:"fragmentId"`
	CellID       int64           `json:"cellId"`
	PageNo       int             `json:"pageNo"`
	BBox         json.RawMessage `json:"bbox"`
	QuoteText    string          `json:"quoteText"`
	TableCellRef string          `json:"tableCellRef"`
	SourceRank   int             `json:"sourceRank"`
	IsPrimary    bool            `json:"isPrimary"`
	CreatedAt    time.Time       `json:"createdAt"`
}

type SubjectAsset struct {
	BaseEntity
	SubjectID   int64  `json:"subjectId"`
	SubjectName string `json:"subjectName"`
	AssetType   string `json:"assetType"`
	AssetKey    string `json:"assetKey"`
	FactID      int64  `json:"factId"`
	Status      string `json:"status"`
}

type SubjectAssetDTO struct {
	ID          int64     `json:"id"`
	SubjectID   int64     `json:"subjectId"`
	SubjectName string    `json:"subjectName"`
	AssetType   string    `json:"assetType"`
	AssetKey    string    `json:"assetKey"`
	FactID      int64     `json:"factId"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type AssemblyItem struct {
	BaseEntity
	CaseID            int64           `json:"caseId"`
	TemplateSlotKey   string          `json:"templateSlotKey"`
	ItemType          string          `json:"itemType"`
	FactID            int64           `json:"factId"`
	SubjectAssetID    int64           `json:"subjectAssetId"`
	DisplayOrder      int             `json:"displayOrder"`
	Status            string          `json:"status"`
	SnapshotValueJSON json.RawMessage `json:"snapshotValueJson"`
}

type AssemblyItemDTO struct {
	ID              int64           `json:"id"`
	CaseID          int64           `json:"caseId"`
	TemplateSlotKey string          `json:"templateSlotKey"`
	ItemType        string          `json:"itemType"`
	FactID          int64           `json:"factId"`
	SubjectAssetID  int64           `json:"subjectAssetId"`
	DisplayOrder    int             `json:"displayOrder"`
	Status          string          `json:"status"`
	SnapshotValue   json.RawMessage `json:"snapshotValue"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

type ReportCaseDetailDTO struct {
	Case           ReportCaseDTO             `json:"case"`
	Files          []ReportCaseFileDTO       `json:"files"`
	Slices         []DocumentSliceDTO        `json:"slices"`
	Tables         []DocumentTableDTO        `json:"tables"`
	TableFragments []DocumentTableFragmentDTO `json:"tableFragments"`
	TableCells     []DocumentTableCellDTO    `json:"tableCells"`
	Facts          []ExtractionFactDTO       `json:"facts"`
	SourceRefs     []FactSourceRefDTO        `json:"sourceRefs"`
	AssemblyItems  []AssemblyItemDTO         `json:"assemblyItems"`
}

type ReviewQueueItemDTO struct {
	CaseFile   ReportCaseFileDTO   `json:"caseFile"`
	Facts      []ExtractionFactDTO `json:"facts"`
	SourceRefs []FactSourceRefDTO  `json:"sourceRefs"`
}

type AssemblyViewDTO struct {
	Case       ReportCaseDTO       `json:"case"`
	Items      []AssemblyItemDTO   `json:"items"`
	Facts      []ExtractionFactDTO `json:"facts"`
	SourceRefs []FactSourceRefDTO  `json:"sourceRefs"`
}

func (entity ReportTemplate) ToDTO() ReportTemplateDTO {
	return ReportTemplateDTO{
		ID:          entity.ID,
		TemplateKey: entity.TemplateKey,
		Name:        entity.Name,
		Description: entity.Description,
		Status:      entity.Status,
		Categories:  entity.CategoriesJSON,
		CreatedAt:   entity.CreatedAt,
		UpdatedAt:   entity.UpdatedAt,
	}
}

func (entity ReportTemplate) ToDetailDTO() ReportTemplateDetailDTO {
	return ReportTemplateDetailDTO{
		ReportTemplateDTO: entity.ToDTO(),
		ProcessingConfig:  entity.ProcessingConfigJSON,
	}
}

func (entity ReportCase) ToDTO() ReportCaseDTO {
	return ReportCaseDTO{
		ID:          entity.ID,
		TemplateID:  entity.TemplateID,
		Name:        entity.Name,
		SubjectID:   entity.SubjectID,
		SubjectName: entity.SubjectName,
		Status:      entity.Status,
		Summary:     entity.SummaryJSON,
		CreatedAt:   entity.CreatedAt,
		UpdatedAt:   entity.UpdatedAt,
	}
}

func (entity ReportCaseFile) ToDTO() ReportCaseFileDTO {
	return ReportCaseFileDTO{
		ID:                  entity.ID,
		CaseID:              entity.CaseID,
		FileID:              entity.FileID,
		VersionNo:           entity.VersionNo,
		ManualCategory:      entity.ManualCategory,
		SuggestedSubCategory: entity.SuggestedSubCategory,
		FinalSubCategory:    entity.FinalSubCategory,
		Status:              entity.Status,
		ReviewStatus:        entity.ReviewStatus,
		Confidence:          entity.Confidence,
		FileType:            entity.FileType,
		SourceType:          entity.SourceType,
		ParseStatus:         entity.ParseStatus,
		OCRPending:          entity.OCRPending,
		IsScannedSuspected:  entity.IsScannedSuspected,
		ProcessingNotes:     entity.ProcessingNotesJSON,
		CreatedAt:           entity.CreatedAt,
		UpdatedAt:           entity.UpdatedAt,
	}
}

func (entity DocumentSlice) ToDTO() DocumentSliceDTO {
	return DocumentSliceDTO{
		ID:            entity.ID,
		ParseJobID:    entity.ParseJobID,
		ParentSliceID: entity.ParentSliceID,
		CaseFileID:    entity.CaseFileID,
		FileID:        entity.FileID,
		VersionNo:     entity.VersionNo,
		SliceType:     entity.SliceType,
		SourceType:    entity.SourceType,
		Title:         entity.Title,
		TitleLevel:    entity.TitleLevel,
		PageStart:     entity.PageStart,
		PageEnd:       entity.PageEnd,
		BBox:          entity.BBoxJSON,
		RawText:       entity.RawText,
		CleanText:     entity.CleanText,
		Table:         entity.TableJSON,
		Confidence:    entity.Confidence,
		ParseStatus:   entity.ParseStatus,
		OCRPending:    entity.OCRPending,
		CreatedAt:     entity.CreatedAt,
	}
}

func (entity DocumentTable) ToDTO() DocumentTableDTO {
	return DocumentTableDTO{
		ID:             entity.ID,
		CaseFileID:     entity.CaseFileID,
		FileID:         entity.FileID,
		VersionNo:      entity.VersionNo,
		Title:          entity.Title,
		PageStart:      entity.PageStart,
		PageEnd:        entity.PageEnd,
		HeaderRowCount: entity.HeaderRowCount,
		ColumnCount:    entity.ColumnCount,
		SourceType:     entity.SourceType,
		ParseStatus:    entity.ParseStatus,
		IsCrossPage:    entity.IsCrossPage,
		BBox:           entity.BBoxJSON,
		CreatedAt:      entity.CreatedAt,
	}
}

func (entity DocumentTableFragment) ToDTO() DocumentTableFragmentDTO {
	return DocumentTableFragmentDTO{
		ID:            entity.ID,
		TableID:       entity.TableID,
		CaseFileID:    entity.CaseFileID,
		PageNo:        entity.PageNo,
		RowStart:      entity.RowStart,
		RowEnd:        entity.RowEnd,
		FragmentOrder: entity.FragmentOrder,
		BBox:          entity.BBoxJSON,
		CreatedAt:     entity.CreatedAt,
	}
}

func (entity DocumentTableCell) ToDTO() DocumentTableCellDTO {
	return DocumentTableCellDTO{
		ID:              entity.ID,
		TableID:         entity.TableID,
		FragmentID:      entity.FragmentID,
		CaseFileID:      entity.CaseFileID,
		RowIndex:        entity.RowIndex,
		ColIndex:        entity.ColIndex,
		RowSpan:         entity.RowSpan,
		ColSpan:         entity.ColSpan,
		RawText:         entity.RawText,
		NormalizedValue: entity.NormalizedValue,
		BBox:            entity.BBoxJSON,
		Confidence:      entity.Confidence,
		CreatedAt:       entity.CreatedAt,
	}
}

func (entity ExtractionFact) ToDTO() ExtractionFactDTO {
	return ExtractionFactDTO{
		ID:              entity.ID,
		CaseID:          entity.CaseID,
		CaseFileID:      entity.CaseFileID,
		FactType:        entity.FactType,
		FactKey:         entity.FactKey,
		FactValue:       entity.FactValueJSON,
		NormalizedValue: entity.NormalizedValueJSON,
		Confidence:      entity.Confidence,
		ReviewStatus:    entity.ReviewStatus,
		ExtractorType:   entity.ExtractorType,
		CreatedAt:       entity.CreatedAt,
		UpdatedAt:       entity.UpdatedAt,
	}
}

func (entity FactSourceRef) ToDTO() FactSourceRefDTO {
	return FactSourceRefDTO{
		ID:           entity.ID,
		FactID:       entity.FactID,
		FileID:       entity.FileID,
		VersionNo:    entity.VersionNo,
		SliceID:      entity.SliceID,
		TableID:      entity.TableID,
		FragmentID:   entity.FragmentID,
		CellID:       entity.CellID,
		PageNo:       entity.PageNo,
		BBox:         entity.BBoxJSON,
		QuoteText:    entity.QuoteText,
		TableCellRef: entity.TableCellRef,
		SourceRank:   entity.SourceRank,
		IsPrimary:    entity.IsPrimary,
		CreatedAt:    entity.CreatedAt,
	}
}

func (entity SubjectAsset) ToDTO() SubjectAssetDTO {
	return SubjectAssetDTO{
		ID:          entity.ID,
		SubjectID:   entity.SubjectID,
		SubjectName: entity.SubjectName,
		AssetType:   entity.AssetType,
		AssetKey:    entity.AssetKey,
		FactID:      entity.FactID,
		Status:      entity.Status,
		CreatedAt:   entity.CreatedAt,
		UpdatedAt:   entity.UpdatedAt,
	}
}

func (entity AssemblyItem) ToDTO() AssemblyItemDTO {
	return AssemblyItemDTO{
		ID:              entity.ID,
		CaseID:          entity.CaseID,
		TemplateSlotKey: entity.TemplateSlotKey,
		ItemType:        entity.ItemType,
		FactID:          entity.FactID,
		SubjectAssetID:  entity.SubjectAssetID,
		DisplayOrder:    entity.DisplayOrder,
		Status:          entity.Status,
		SnapshotValue:   entity.SnapshotValueJSON,
		CreatedAt:       entity.CreatedAt,
		UpdatedAt:       entity.UpdatedAt,
	}
}
