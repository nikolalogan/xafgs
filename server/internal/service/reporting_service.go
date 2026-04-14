package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type ReportingService interface {
	ListReportTemplates(ctx context.Context) ([]model.ReportTemplateDTO, *model.APIError)
	GetReportTemplate(ctx context.Context, templateID int64) (model.ReportTemplateDetailDTO, *model.APIError)
	CreateReportTemplate(ctx context.Context, request model.CreateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError)
	UpdateReportTemplate(ctx context.Context, templateID int64, request model.UpdateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError)

	ListReportCases(ctx context.Context) ([]model.ReportCaseDTO, *model.APIError)
	GetReportCase(ctx context.Context, caseID int64) (model.ReportCaseDetailDTO, *model.APIError)
	CreateReportCase(ctx context.Context, request model.CreateReportCaseRequest, operatorID int64) (model.ReportCaseDTO, *model.APIError)
	AttachReportCaseFile(ctx context.Context, caseID int64, request model.AttachReportCaseFileRequest, operatorID int64) (model.ReportCaseFileDTO, *model.APIError)
	ProcessReportCase(ctx context.Context, caseID int64, request model.ProcessReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError)
	GetReviewQueue(ctx context.Context, caseID int64) ([]model.ReviewQueueItemDTO, *model.APIError)
	ReviewReportCase(ctx context.Context, caseID int64, request model.ReviewReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError)
	GetAssembly(ctx context.Context, caseID int64) (model.AssemblyViewDTO, *model.APIError)
	ListSubjectAssets(ctx context.Context, subjectID int64) ([]model.SubjectAssetDTO, *model.APIError)
}

type reportingService struct {
	reportingRepository  repository.ReportingRepository
	fileRepository       repository.FileRepository
	documentParseService DocumentParseService
}

func NewReportingService(reportingRepository repository.ReportingRepository, fileRepository repository.FileRepository, documentParseService DocumentParseService) ReportingService {
	return &reportingService{
		reportingRepository:  reportingRepository,
		fileRepository:       fileRepository,
		documentParseService: documentParseService,
	}
}

func (service *reportingService) ListReportTemplates(_ context.Context) ([]model.ReportTemplateDTO, *model.APIError) {
	return service.reportingRepository.FindAllReportTemplates(), nil
}

func (service *reportingService) GetReportTemplate(_ context.Context, templateID int64) (model.ReportTemplateDetailDTO, *model.APIError) {
	entity, ok := service.reportingRepository.FindReportTemplateByID(templateID)
	if !ok {
		return model.ReportTemplateDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	return entity.ToDetailDTO(), nil
}

func (service *reportingService) CreateReportTemplate(_ context.Context, request model.CreateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError) {
	request.TemplateKey = strings.TrimSpace(request.TemplateKey)
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)
	if request.TemplateKey == "" || request.Name == "" {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateKey、name 不能为空")
	}
	if request.Status == "" {
		request.Status = model.ReportTemplateStatusActive
	}
	if !model.IsValidReportTemplateStatus(request.Status) {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}
	if _, exists := service.reportingRepository.FindReportTemplateByKey(request.TemplateKey); exists {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateKey 已存在")
	}
	categories, apiError := normalizeJSONArray(request.CategoriesJSON, "categoriesJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	config, apiError := normalizeJSONObject(request.ProcessingConfigJSON, "processingConfigJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	return service.reportingRepository.CreateReportTemplate(model.ReportTemplate{
		BaseEntity:           model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		TemplateKey:          request.TemplateKey,
		Name:                 request.Name,
		Description:          request.Description,
		Status:               request.Status,
		CategoriesJSON:       categories,
		ProcessingConfigJSON: config,
	}), nil
}

func (service *reportingService) UpdateReportTemplate(_ context.Context, templateID int64, request model.UpdateReportTemplateRequest, operatorID int64) (model.ReportTemplateDTO, *model.APIError) {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	request.Status = strings.TrimSpace(request.Status)
	if request.Name == "" {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "name 不能为空")
	}
	if request.Status == "" {
		request.Status = model.ReportTemplateStatusActive
	}
	if !model.IsValidReportTemplateStatus(request.Status) {
		return model.ReportTemplateDTO{}, model.NewAPIError(400, response.CodeBadRequest, "status 仅支持 active/disabled")
	}
	categories, apiError := normalizeJSONArray(request.CategoriesJSON, "categoriesJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	config, apiError := normalizeJSONObject(request.ProcessingConfigJSON, "processingConfigJson")
	if apiError != nil {
		return model.ReportTemplateDTO{}, apiError
	}
	updated, ok := service.reportingRepository.UpdateReportTemplate(templateID, model.ReportTemplate{
		Name:                 request.Name,
		Description:          request.Description,
		Status:               request.Status,
		CategoriesJSON:       categories,
		ProcessingConfigJSON: config,
		BaseEntity:           model.BaseEntity{UpdatedBy: operatorID},
	})
	if !ok {
		return model.ReportTemplateDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	return updated, nil
}

func (service *reportingService) ListReportCases(_ context.Context) ([]model.ReportCaseDTO, *model.APIError) {
	return service.reportingRepository.FindAllReportCases(), nil
}

func (service *reportingService) GetReportCase(_ context.Context, caseID int64) (model.ReportCaseDetailDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	files := service.reportingRepository.FindReportCaseFiles(caseID)
	fileDTOs := make([]model.ReportCaseFileDTO, 0, len(files))
	for _, item := range files {
		fileDTOs = append(fileDTOs, item.ToDTO())
	}
	return model.ReportCaseDetailDTO{
		Case:           reportCase.ToDTO(),
		Files:          fileDTOs,
		Slices:         service.reportingRepository.FindDocumentSlicesByCaseID(caseID),
		Tables:         service.reportingRepository.FindTablesByCaseID(caseID),
		TableFragments: service.reportingRepository.FindTableFragmentsByCaseID(caseID),
		TableCells:     service.reportingRepository.FindTableCellsByCaseID(caseID),
		Facts:          toFactDTOs(service.reportingRepository.FindFactsByCaseID(caseID)),
		SourceRefs:     service.reportingRepository.FindSourceRefsByCaseID(caseID),
		AssemblyItems:  service.reportingRepository.FindAssemblyItemsByCaseID(caseID),
	}, nil
}

func (service *reportingService) CreateReportCase(_ context.Context, request model.CreateReportCaseRequest, operatorID int64) (model.ReportCaseDTO, *model.APIError) {
	request.Name = strings.TrimSpace(request.Name)
	request.SubjectName = strings.TrimSpace(request.SubjectName)
	if request.TemplateID <= 0 || request.Name == "" {
		return model.ReportCaseDTO{}, model.NewAPIError(400, response.CodeBadRequest, "templateId、name 不能为空")
	}
	if _, ok := service.reportingRepository.FindReportTemplateByID(request.TemplateID); !ok {
		return model.ReportCaseDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告模板不存在")
	}
	summary, _ := json.Marshal(map[string]any{
		"fileCount":          0,
		"readyCount":         0,
		"reviewPendingCount": 0,
	})
	return service.reportingRepository.CreateReportCase(model.ReportCase{
		BaseEntity:  model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		TemplateID:  request.TemplateID,
		Name:        request.Name,
		SubjectID:   request.SubjectID,
		SubjectName: request.SubjectName,
		Status:      model.ReportCaseStatusDraft,
		SummaryJSON: summary,
	}), nil
}

func (service *reportingService) AttachReportCaseFile(_ context.Context, caseID int64, request model.AttachReportCaseFileRequest, operatorID int64) (model.ReportCaseFileDTO, *model.APIError) {
	request.ManualCategory = strings.TrimSpace(request.ManualCategory)
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseFileDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	if request.FileID <= 0 || request.ManualCategory == "" {
		return model.ReportCaseFileDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId、manualCategory 不能为空")
	}
	if _, exists := service.reportingRepository.FindReportCaseFile(caseID, request.FileID); exists {
		return model.ReportCaseFileDTO{}, model.NewAPIError(400, response.CodeBadRequest, "该文件已挂接到当前报告")
	}
	fileEntity, ok := service.fileRepository.FindFileByID(request.FileID)
	if !ok || fileEntity.LatestVersionNo <= 0 {
		return model.ReportCaseFileDTO{}, model.NewAPIError(404, response.CodeNotFound, "底层文件不存在或无已上传版本")
	}
	notes, _ := json.Marshal(map[string]any{
		"attachedBy":       operatorID,
		"processingStatus": "not_started",
	})
	dto := service.reportingRepository.CreateReportCaseFile(model.ReportCaseFile{
		BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		CaseID:              reportCase.ID,
		FileID:              request.FileID,
		VersionNo:           fileEntity.LatestVersionNo,
		ManualCategory:      request.ManualCategory,
		Status:              model.ReportCaseFileStatusUploaded,
		ReviewStatus:        model.ReviewStatusPending,
		Confidence:          0,
		ParseStatus:         model.DocumentParseStatusPending,
		SourceType:          "",
		FileType:            "",
		OCRPending:          false,
		IsScannedSuspected:  false,
		ProcessingNotesJSON: notes,
	})
	_ = service.refreshCaseSummary(reportCase, operatorID)
	return dto, nil
}

func (service *reportingService) ProcessReportCase(ctx context.Context, caseID int64, _ model.ProcessReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	reportCase.Status = model.ReportCaseStatusProcessing
	reportCase.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCase(reportCase)

	for _, caseFile := range service.reportingRepository.FindReportCaseFiles(caseID) {
		if apiError := service.processSingleCaseFile(ctx, reportCase, caseFile, operatorID); apiError != nil {
			return model.ReportCaseDetailDTO{}, apiError
		}
	}

	reportCase.Status = model.ReportCaseStatusPendingReview
	reportCase.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCase(reportCase)
	_ = service.refreshCaseSummary(reportCase, operatorID)
	return service.GetReportCase(context.Background(), caseID)
}

func (service *reportingService) GetReviewQueue(_ context.Context, caseID int64) ([]model.ReviewQueueItemDTO, *model.APIError) {
	if _, ok := service.reportingRepository.FindReportCaseByID(caseID); !ok {
		return nil, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	caseFiles := service.reportingRepository.FindReportCaseFiles(caseID)
	out := make([]model.ReviewQueueItemDTO, 0)
	for _, caseFile := range caseFiles {
		if caseFile.ReviewStatus != model.ReviewStatusPending {
			continue
		}
		facts := service.reportingRepository.FindFactsByCaseFileID(caseFile.ID)
		factIDs := make([]int64, 0, len(facts))
		for _, fact := range facts {
			factIDs = append(factIDs, fact.ID)
		}
		out = append(out, model.ReviewQueueItemDTO{
			CaseFile:   caseFile.ToDTO(),
			Facts:      toFactDTOs(facts),
			SourceRefs: toSourceRefDTOs(service.reportingRepository.FindSourceRefsByFactIDs(factIDs)),
		})
	}
	return out, nil
}

func (service *reportingService) ReviewReportCase(_ context.Context, caseID int64, request model.ReviewReportCaseRequest, operatorID int64) (model.ReportCaseDetailDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	for _, decision := range request.Decisions {
		caseFile, ok := service.reportingRepository.FindReportCaseFileByID(decision.CaseFileID)
		if !ok || caseFile.CaseID != caseID {
			return model.ReportCaseDetailDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告文件不存在")
		}
		decision.Decision = strings.TrimSpace(decision.Decision)
		decision.FinalSubCategory = strings.TrimSpace(decision.FinalSubCategory)
		switch decision.Decision {
		case model.ReviewStatusApproved:
			caseFile.ReviewStatus = model.ReviewStatusApproved
			caseFile.Status = model.ReportCaseFileStatusApproved
			if decision.FinalSubCategory != "" {
				caseFile.FinalSubCategory = decision.FinalSubCategory
			} else if caseFile.FinalSubCategory == "" {
				caseFile.FinalSubCategory = caseFile.SuggestedSubCategory
			}
			caseFile.UpdatedBy = operatorID
			_, _ = service.reportingRepository.UpdateReportCaseFile(caseFile)
			for _, fact := range service.reportingRepository.FindFactsByCaseFileID(caseFile.ID) {
				fact.ReviewStatus = model.ReviewStatusApproved
				_, _ = service.reportingRepository.UpdateExtractionFact(fact)
				if reportCase.SubjectID > 0 && (caseFile.ManualCategory == "主体" || caseFile.ManualCategory == "财务") {
					service.reportingRepository.CreateSubjectAsset(model.SubjectAsset{
						BaseEntity:  model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
						SubjectID:   reportCase.SubjectID,
						SubjectName: reportCase.SubjectName,
						AssetType:   caseFile.ManualCategory,
						AssetKey:    fact.FactKey,
						FactID:      fact.ID,
						Status:      model.ReviewStatusApproved,
					})
				}
			}
		case model.ReviewStatusRejected:
			caseFile.ReviewStatus = model.ReviewStatusRejected
			caseFile.Status = model.ReportCaseFileStatusRejected
			caseFile.UpdatedBy = operatorID
			_, _ = service.reportingRepository.UpdateReportCaseFile(caseFile)
			for _, fact := range service.reportingRepository.FindFactsByCaseFileID(caseFile.ID) {
				fact.ReviewStatus = model.ReviewStatusRejected
				_, _ = service.reportingRepository.UpdateExtractionFact(fact)
			}
		default:
			return model.ReportCaseDetailDTO{}, model.NewAPIError(400, response.CodeBadRequest, "decision 仅支持 approved/rejected")
		}
	}
	if err := service.rebuildAssembly(reportCase, operatorID); err != nil {
		return model.ReportCaseDetailDTO{}, err
	}
	reportCase.Status = model.ReportCaseStatusReady
	reportCase.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCase(reportCase)
	_ = service.refreshCaseSummary(reportCase, operatorID)
	return service.GetReportCase(context.Background(), caseID)
}

func (service *reportingService) GetAssembly(_ context.Context, caseID int64) (model.AssemblyViewDTO, *model.APIError) {
	reportCase, ok := service.reportingRepository.FindReportCaseByID(caseID)
	if !ok {
		return model.AssemblyViewDTO{}, model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	facts := service.reportingRepository.FindFactsByCaseID(caseID)
	factIDs := make([]int64, 0, len(facts))
	for _, fact := range facts {
		factIDs = append(factIDs, fact.ID)
	}
	return model.AssemblyViewDTO{
		Case:       reportCase.ToDTO(),
		Items:      service.reportingRepository.FindAssemblyItemsByCaseID(caseID),
		Facts:      toFactDTOs(facts),
		SourceRefs: toSourceRefDTOs(service.reportingRepository.FindSourceRefsByFactIDs(factIDs)),
	}, nil
}

func (service *reportingService) ListSubjectAssets(_ context.Context, subjectID int64) ([]model.SubjectAssetDTO, *model.APIError) {
	return service.reportingRepository.FindSubjectAssets(subjectID), nil
}

func (service *reportingService) processSingleCaseFile(ctx context.Context, reportCase model.ReportCase, caseFile model.ReportCaseFile, operatorID int64) *model.APIError {
	fileEntity, ok := service.fileRepository.FindFileByID(caseFile.FileID)
	if !ok || fileEntity.LatestVersionNo <= 0 {
		return model.NewAPIError(404, response.CodeNotFound, "底层文件不存在")
	}
	caseFile.VersionNo = fileEntity.LatestVersionNo
	parsed, apiError := service.documentParseService.ParseCaseFile(ctx, caseFile)
	if apiError != nil {
		return apiError
	}

	caseFile.SuggestedSubCategory = service.suggestSubCategory(caseFile.ManualCategory, parsed.Version.OriginName)
	caseFile.FinalSubCategory = ""
	caseFile.Status = model.ReportCaseFileStatusPendingReview
	caseFile.ReviewStatus = model.ReviewStatusPending
	caseFile.Confidence = service.deriveConfidence(parsed.Version.OriginName, parsed.Profile)
	caseFile.FileType = parsed.Profile.FileType
	caseFile.SourceType = parsed.Profile.SourceType
	caseFile.ParseStatus = chooseParseStatus(parsed)
	caseFile.OCRPending = parsed.OCRTask != nil && parsed.OCRTask.Status != model.OCRTaskStatusSucceeded
	caseFile.IsScannedSuspected = parsed.Profile.IsScannedSuspected
	notes, _ := json.Marshal(map[string]any{
		"originName":         parsed.Version.OriginName,
		"mimeType":           parsed.Version.MimeType,
		"sizeBytes":          parsed.Version.SizeBytes,
		"parseStrategy":      parsed.Profile.ParseStrategy,
		"hasTextLayer":       parsed.Profile.HasTextLayer,
		"textDensity":        parsed.Profile.TextDensity,
		"traceable":          true,
		"ocrProvider":        reportingOCRProvider(parsed),
		"ocrPending":         caseFile.OCRPending,
		"ocrTaskId":          reportingOCRTaskID(parsed),
		"ocrTaskStatus":      reportingOCRTaskStatus(parsed),
		"isScannedSuspected": parsed.Profile.IsScannedSuspected,
		"pdfDiagnostics":     parsed.Profile.PDFDiagnostics,
	})
	caseFile.ProcessingNotesJSON = notes
	caseFile.UpdatedBy = operatorID
	_, _ = service.reportingRepository.UpdateReportCaseFile(caseFile)

	service.reportingRepository.DeleteSlicesByCaseFileID(caseFile.ID)
	service.reportingRepository.DeleteTablesByCaseFileID(caseFile.ID)
	removedFactIDs := service.reportingRepository.DeleteFactsByCaseFileID(caseFile.ID)
	service.reportingRepository.DeleteSourceRefsByFactIDs(removedFactIDs)

	persistedSlices := make([]model.DocumentSliceDTO, 0, len(parsed.Slices))
	for _, slice := range parsed.Slices {
		slice.CaseFileID = caseFile.ID
		slice.FileID = caseFile.FileID
		slice.VersionNo = parsed.Version.VersionNo
		persistedSlices = append(persistedSlices, service.reportingRepository.CreateDocumentSlice(slice))
	}

	persistedTables := make([]model.DocumentTableDTO, 0, len(parsed.Tables))
	persistedFragments := make([]model.DocumentTableFragmentDTO, 0, len(parsed.TableFragments))
	persistedCells := make([]model.DocumentTableCellDTO, 0, len(parsed.TableCells))
	tableIDMap := make(map[int64]int64, len(parsed.Tables))
	fragmentIDMap := make(map[int64]int64, len(parsed.TableFragments))

	if len(parsed.Tables) > 0 {
		for index, table := range parsed.Tables {
			originalTableID := table.ID
			if originalTableID == 0 {
				originalTableID = int64(index + 1)
			}
			table.CaseFileID = caseFile.ID
			table.FileID = caseFile.FileID
			table.VersionNo = parsed.Version.VersionNo
			persisted := service.reportingRepository.CreateDocumentTable(table)
			persistedTables = append(persistedTables, persisted)
			tableIDMap[originalTableID] = persisted.ID
		}
	}
	if len(parsed.TableFragments) > 0 && len(persistedTables) > 0 {
		defaultTableID := persistedTables[0].ID
		for index, fragment := range parsed.TableFragments {
			originalFragmentID := fragment.ID
			if originalFragmentID == 0 {
				originalFragmentID = int64(index + 1)
			}
			fragment.CaseFileID = caseFile.ID
			if mappedTableID, ok := tableIDMap[fragment.TableID]; ok {
				fragment.TableID = mappedTableID
			} else {
				fragment.TableID = defaultTableID
			}
			persisted := service.reportingRepository.CreateDocumentTableFragment(fragment)
			persistedFragments = append(persistedFragments, persisted)
			fragmentIDMap[originalFragmentID] = persisted.ID
		}
	}
	if len(parsed.TableCells) > 0 && len(persistedTables) > 0 && len(persistedFragments) > 0 {
		defaultTableID := persistedTables[0].ID
		defaultFragmentID := persistedFragments[0].ID
		for _, cell := range parsed.TableCells {
			cell.CaseFileID = caseFile.ID
			if mappedTableID, ok := tableIDMap[cell.TableID]; ok {
				cell.TableID = mappedTableID
			} else {
				cell.TableID = defaultTableID
			}
			if mappedFragmentID, ok := fragmentIDMap[cell.FragmentID]; ok {
				cell.FragmentID = mappedFragmentID
			} else {
				cell.FragmentID = defaultFragmentID
			}
			persistedCells = append(persistedCells, service.reportingRepository.CreateDocumentTableCell(cell))
		}
	}

	service.createProfileFact(caseFile, parsed, persistedSlices, operatorID)
	service.createSliceFacts(reportCase, caseFile, parsed, persistedSlices, operatorID)
	service.createTableFacts(reportCase, caseFile, persistedTables, persistedCells, operatorID)
	return nil
}

func (service *reportingService) createProfileFact(caseFile model.ReportCaseFile, parsed ParsedDocument, slices []model.DocumentSliceDTO, operatorID int64) {
	profileValue, _ := json.Marshal(parsed.Profile)
	fact := service.reportingRepository.CreateExtractionFact(model.ExtractionFact{
		BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
		CaseID:              caseFile.CaseID,
		CaseFileID:          caseFile.ID,
		FactType:            "document_profile",
		FactKey:             "profile." + normalizeKey(caseFile.ManualCategory),
		FactValueJSON:       profileValue,
		NormalizedValueJSON: profileValue,
		Confidence:          caseFile.Confidence,
		ReviewStatus:        model.ReviewStatusPending,
		ExtractorType:       "system",
	})
	if len(slices) > 0 {
		service.reportingRepository.CreateFactSourceRef(model.FactSourceRef{
			FactID:     fact.ID,
			FileID:     caseFile.FileID,
			VersionNo:  parsed.Version.VersionNo,
			SliceID:    slices[0].ID,
			PageNo:     slices[0].PageStart,
			BBoxJSON:   slices[0].BBox,
			QuoteText:  parsed.Version.OriginName,
			SourceRank: 1,
			IsPrimary:  true,
		})
	}
}

func (service *reportingService) createSliceFacts(reportCase model.ReportCase, caseFile model.ReportCaseFile, parsed ParsedDocument, slices []model.DocumentSliceDTO, operatorID int64) {
	for _, slice := range slices {
		if slice.SliceType != model.DocumentStructureParagraph && slice.SliceType != model.DocumentStructureSection {
			continue
		}
		content := strings.TrimSpace(slice.CleanText)
		if content == "" {
			continue
		}
		if len([]rune(content)) > 240 {
			content = string([]rune(content)[:240]) + "…"
		}
		value, _ := json.Marshal(map[string]any{
			"title":      slice.Title,
			"sliceType":  slice.SliceType,
			"sourceType": slice.SourceType,
			"content":    content,
		})
		fact := service.reportingRepository.CreateExtractionFact(model.ExtractionFact{
			BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
			CaseID:              reportCase.ID,
			CaseFileID:          caseFile.ID,
			FactType:            "slice_excerpt",
			FactKey:             "slice." + normalizeKey(caseFile.ManualCategory) + "." + strconvSafe(slice.ID),
			FactValueJSON:       value,
			NormalizedValueJSON: value,
			Confidence:          slice.Confidence,
			ReviewStatus:        model.ReviewStatusPending,
			ExtractorType:       parsed.Profile.SourceType,
		})
		service.reportingRepository.CreateFactSourceRef(model.FactSourceRef{
			FactID:     fact.ID,
			FileID:     caseFile.FileID,
			VersionNo:  parsed.Version.VersionNo,
			SliceID:    slice.ID,
			PageNo:     slice.PageStart,
			BBoxJSON:   slice.BBox,
			QuoteText:  content,
			SourceRank: 1,
			IsPrimary:  true,
		})
	}
}

func (service *reportingService) createTableFacts(reportCase model.ReportCase, caseFile model.ReportCaseFile, tables []model.DocumentTableDTO, cells []model.DocumentTableCellDTO, operatorID int64) {
	for _, table := range tables {
		value, _ := json.Marshal(map[string]any{
			"title":          table.Title,
			"columnCount":    table.ColumnCount,
			"headerRowCount": table.HeaderRowCount,
			"parseStatus":    table.ParseStatus,
		})
		fact := service.reportingRepository.CreateExtractionFact(model.ExtractionFact{
			BaseEntity:          model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
			CaseID:              reportCase.ID,
			CaseFileID:          caseFile.ID,
			FactType:            "table_summary",
			FactKey:             "table." + normalizeKey(caseFile.ManualCategory) + "." + strconvSafe(table.ID),
			FactValueJSON:       value,
			NormalizedValueJSON: value,
			Confidence:          0.95,
			ReviewStatus:        model.ReviewStatusPending,
			ExtractorType:       table.SourceType,
		})
		primaryCell := firstCellForTable(cells, table.ID)
		service.reportingRepository.CreateFactSourceRef(model.FactSourceRef{
			FactID:       fact.ID,
			FileID:       caseFile.FileID,
			VersionNo:    caseFile.VersionNo,
			TableID:      table.ID,
			FragmentID:   primaryCell.FragmentID,
			CellID:       primaryCell.ID,
			PageNo:       table.PageStart,
			BBoxJSON:     table.BBox,
			QuoteText:    primaryCell.RawText,
			TableCellRef: buildCellRef(primaryCell.RowIndex, primaryCell.ColIndex),
			SourceRank:   1,
			IsPrimary:    true,
		})
	}
}

func (service *reportingService) rebuildAssembly(reportCase model.ReportCase, operatorID int64) *model.APIError {
	service.reportingRepository.DeleteAssemblyItemsByCaseID(reportCase.ID)
	approvedFiles := service.reportingRepository.FindReportCaseFiles(reportCase.ID)
	sort.Slice(approvedFiles, func(i, j int) bool { return approvedFiles[i].ID < approvedFiles[j].ID })
	displayOrder := 1
	for _, caseFile := range approvedFiles {
		if caseFile.ReviewStatus != model.ReviewStatusApproved {
			continue
		}
		facts := service.reportingRepository.FindFactsByCaseFileID(caseFile.ID)
		for _, fact := range facts {
			if fact.ReviewStatus != model.ReviewStatusApproved {
				continue
			}
			snapshot, _ := json.Marshal(map[string]any{
				"manualCategory":   caseFile.ManualCategory,
				"finalSubCategory": caseFile.FinalSubCategory,
				"factKey":          fact.FactKey,
				"factValue":        json.RawMessage(fact.FactValueJSON),
				"parseStatus":      caseFile.ParseStatus,
				"sourceType":       caseFile.SourceType,
			})
			service.reportingRepository.CreateAssemblyItem(model.AssemblyItem{
				BaseEntity:        model.BaseEntity{CreatedBy: operatorID, UpdatedBy: operatorID},
				CaseID:            reportCase.ID,
				TemplateSlotKey:   caseFile.ManualCategory,
				ItemType:          "fact",
				FactID:            fact.ID,
				SubjectAssetID:    0,
				DisplayOrder:      displayOrder,
				Status:            model.AssemblyItemStatusReady,
				SnapshotValueJSON: snapshot,
			})
			displayOrder++
		}
	}
	return nil
}

func (service *reportingService) refreshCaseSummary(reportCase model.ReportCase, operatorID int64) *model.APIError {
	files := service.reportingRepository.FindReportCaseFiles(reportCase.ID)
	readyCount := 0
	reviewPendingCount := 0
	needsOCRCount := 0
	for _, item := range files {
		if item.ReviewStatus == model.ReviewStatusApproved {
			readyCount++
		}
		if item.ReviewStatus == model.ReviewStatusPending {
			reviewPendingCount++
		}
		if item.OCRPending {
			needsOCRCount++
		}
	}
	summary, _ := json.Marshal(map[string]any{
		"fileCount":          len(files),
		"readyCount":         readyCount,
		"reviewPendingCount": reviewPendingCount,
		"needsOCRCount":      needsOCRCount,
	})
	reportCase.SummaryJSON = summary
	reportCase.UpdatedBy = operatorID
	_, ok := service.reportingRepository.UpdateReportCase(reportCase)
	if !ok {
		return model.NewAPIError(404, response.CodeNotFound, "报告实例不存在")
	}
	return nil
}

func (service *reportingService) suggestSubCategory(category, originName string) string {
	name := strings.ToLower(strings.TrimSpace(originName))
	switch category {
	case "主体":
		if strings.Contains(name, "营业") || strings.Contains(name, "license") {
			return "证照材料"
		}
		if strings.Contains(name, "股东") || strings.Contains(name, "章程") {
			return "主体治理"
		}
		return "主体基础资料"
	case "区域":
		if strings.Contains(name, "财政") || strings.Contains(name, "预算") {
			return "区域财政材料"
		}
		return "区域基础材料"
	case "财务":
		if strings.Contains(name, "审计") {
			return "审计报告"
		}
		if strings.Contains(name, "报表") || strings.Contains(name, "balance") || strings.Contains(name, "csv") {
			return "财务报表"
		}
		return "财务基础材料"
	case "项目":
		if strings.Contains(name, "可研") {
			return "可研材料"
		}
		return "项目材料"
	case "反担保":
		return "反担保材料"
	default:
		return "待细分"
	}
}

func (service *reportingService) deriveConfidence(originName string, profile DocumentProfile) float64 {
	name := strings.TrimSpace(originName)
	if profile.OCRRequired {
		return 0.46
	}
	if name == "" {
		return 0.52
	}
	if strings.Contains(strings.ToLower(name), "audit") || strings.Contains(name, "审计") {
		return 0.93
	}
	if profile.FileType == "csv" || profile.FileType == "tsv" {
		return 0.97
	}
	if profile.FileType == "pdf" && profile.HasTextLayer {
		if profile.ParseStrategy == "pdf_decode_failed" {
			return 0.25
		}
		return 0.9
	}
	return 0.82
}

func chooseParseStatus(parsed ParsedDocument) string {
	if parsed.Profile.OCRRequired {
		return model.DocumentParseStatusNeedsOCR
	}
	if parsed.Profile.ParseStrategy == "pdf_decode_failed" {
		return model.DocumentParseStatusFailed
	}
	if len(parsed.Slices) == 0 && len(parsed.Tables) == 0 {
		return model.DocumentParseStatusFailed
	}
	allFailed := true
	for _, slice := range parsed.Slices {
		if slice.ParseStatus != model.DocumentParseStatusFailed {
			allFailed = false
			break
		}
	}
	if allFailed && len(parsed.Slices) > 0 {
		return model.DocumentParseStatusFailed
	}
	return model.DocumentParseStatusParsed
}

func reportingOCRProvider(parsed ParsedDocument) string {
	if parsed.OCRTask == nil {
		return "noop"
	}
	if strings.TrimSpace(parsed.OCRTask.ProviderUsed) != "" {
		return parsed.OCRTask.ProviderUsed
	}
	if strings.TrimSpace(parsed.OCRTask.ProviderMode) != "" {
		return parsed.OCRTask.ProviderMode
	}
	return "noop"
}

func reportingOCRTaskID(parsed ParsedDocument) int64 {
	if parsed.OCRTask == nil {
		return 0
	}
	return parsed.OCRTask.ID
}

func reportingOCRTaskStatus(parsed ParsedDocument) string {
	if parsed.OCRTask == nil {
		return ""
	}
	return parsed.OCRTask.Status
}

func normalizeJSONArray(raw json.RawMessage, fieldName string) (json.RawMessage, *model.APIError) {
	if len(raw) == 0 {
		return json.RawMessage(`[]`), nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 不是合法 JSON")
	}
	if _, ok := root.([]any); !ok {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 必须为 JSON array")
	}
	normalized, _ := json.Marshal(root)
	return normalized, nil
}

func normalizeJSONObject(raw json.RawMessage, fieldName string) (json.RawMessage, *model.APIError) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 不是合法 JSON")
	}
	if _, ok := root.(map[string]any); !ok {
		return nil, model.NewAPIError(400, response.CodeBadRequest, fieldName+" 必须为 JSON object")
	}
	normalized, _ := json.Marshal(root)
	return normalized, nil
}

func toFactDTOs(items []model.ExtractionFact) []model.ExtractionFactDTO {
	out := make([]model.ExtractionFactDTO, 0, len(items))
	for _, item := range items {
		out = append(out, item.ToDTO())
	}
	return out
}

func toSourceRefDTOs(items []model.FactSourceRef) []model.FactSourceRefDTO {
	out := make([]model.FactSourceRefDTO, 0, len(items))
	for _, item := range items {
		out = append(out, item.ToDTO())
	}
	return out
}

func normalizeKey(raw string) string {
	replacer := strings.NewReplacer(" ", "_", "/", "_", "-", "_")
	return strings.ToLower(replacer.Replace(strings.TrimSpace(raw)))
}

func strconvSafe(value int64) string {
	return fmt.Sprintf("%d", value)
}

func buildCellRef(rowIndex, colIndex int) string {
	return fmt.Sprintf("r%d_c%d", rowIndex, colIndex)
}

func firstCellForTable(cells []model.DocumentTableCellDTO, tableID int64) model.DocumentTableCellDTO {
	for _, cell := range cells {
		if cell.TableID == tableID {
			return cell
		}
	}
	return model.DocumentTableCellDTO{}
}
