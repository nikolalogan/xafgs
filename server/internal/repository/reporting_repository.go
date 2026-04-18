package repository

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type ReportingRepository interface {
	FindReportTemplateByID(templateID int64) (model.ReportTemplate, bool)
	FindReportTemplateByKey(templateKey string) (model.ReportTemplate, bool)
	FindAllReportTemplates() []model.ReportTemplateDTO
	CreateReportTemplate(template model.ReportTemplate) model.ReportTemplateDTO
	UpdateReportTemplate(templateID int64, update model.ReportTemplate) (model.ReportTemplateDTO, bool)

	FindReportCaseByID(caseID int64) (model.ReportCase, bool)
	FindAllReportCases() []model.ReportCaseDTO
	CreateReportCase(reportCase model.ReportCase) model.ReportCaseDTO
	UpdateReportCase(reportCase model.ReportCase) (model.ReportCaseDTO, bool)

	FindEnterpriseProjectByID(projectID int64) (model.EnterpriseProject, bool)
	FindEnterpriseProjectsByEnterpriseID(enterpriseID int64) []model.EnterpriseProjectDTO
	CreateEnterpriseProject(project model.EnterpriseProject) model.EnterpriseProjectDTO
	UpdateEnterpriseProject(project model.EnterpriseProject) (model.EnterpriseProjectDTO, bool)

	CreateReportParseJob(job model.ReportParseJob) model.ReportParseJob
	FindReportParseJobsByProjectID(projectID int64) []model.ReportParseJob
	FindReportParseJobByID(jobID int64) (model.ReportParseJob, bool)
	ClaimNextReportParseJob(maxRetry int) (model.ReportParseJob, bool)
	UpdateReportParseJob(job model.ReportParseJob) (model.ReportParseJob, bool)
	DeleteReportParseJobsByCaseFileID(caseFileID int64)

	FindReportCaseFiles(caseID int64) []model.ReportCaseFile
	FindReportCaseFileByID(caseFileID int64) (model.ReportCaseFile, bool)
	FindReportCaseFile(caseID int64, fileID int64) (model.ReportCaseFile, bool)
	CreateReportCaseFile(caseFile model.ReportCaseFile) model.ReportCaseFileDTO
	UpdateReportCaseFile(caseFile model.ReportCaseFile) (model.ReportCaseFileDTO, bool)
	DeleteReportCaseFile(caseFileID int64) bool

	DeleteSlicesByCaseFileID(caseFileID int64)
	CreateDocumentSlice(slice model.DocumentSlice) model.DocumentSliceDTO
	FindDocumentSlicesByCaseID(caseID int64) []model.DocumentSliceDTO
	FindDocumentSlicesByCaseFileID(caseFileID int64) []model.DocumentSlice

	DeleteTablesByCaseFileID(caseFileID int64)
	CreateDocumentTable(table model.DocumentTable) model.DocumentTableDTO
	CreateDocumentTableFragment(fragment model.DocumentTableFragment) model.DocumentTableFragmentDTO
	CreateDocumentTableCell(cell model.DocumentTableCell) model.DocumentTableCellDTO
	FindTablesByCaseID(caseID int64) []model.DocumentTableDTO
	FindTableFragmentsByCaseID(caseID int64) []model.DocumentTableFragmentDTO
	FindTableCellsByCaseID(caseID int64) []model.DocumentTableCellDTO

	DeleteFactsByCaseFileID(caseFileID int64) []int64
	CreateExtractionFact(fact model.ExtractionFact) model.ExtractionFactDTO
	UpdateExtractionFact(fact model.ExtractionFact) (model.ExtractionFactDTO, bool)
	FindFactsByCaseID(caseID int64) []model.ExtractionFact
	FindFactsByCaseFileID(caseFileID int64) []model.ExtractionFact
	FindFactByID(factID int64) (model.ExtractionFact, bool)

	DeleteSourceRefsByFactIDs(factIDs []int64)
	CreateFactSourceRef(ref model.FactSourceRef) model.FactSourceRefDTO
	FindSourceRefsByCaseID(caseID int64) []model.FactSourceRefDTO
	FindSourceRefsByFactIDs(factIDs []int64) []model.FactSourceRef

	DeleteAssemblyItemsByCaseID(caseID int64)
	CreateAssemblyItem(item model.AssemblyItem) model.AssemblyItemDTO
	FindAssemblyItemsByCaseID(caseID int64) []model.AssemblyItemDTO

	FindSubjectAssets(subjectID int64) []model.SubjectAssetDTO
	CreateSubjectAsset(asset model.SubjectAsset) model.SubjectAssetDTO
}

type reportingRepository struct {
	reportTemplates         map[int64]model.ReportTemplate
	reportCases             map[int64]model.ReportCase
	enterpriseProjects      map[int64]model.EnterpriseProject
	reportCaseFiles         map[int64]model.ReportCaseFile
	reportParseJobs         map[int64]model.ReportParseJob
	documentSlices          map[int64]model.DocumentSlice
	documentTables          map[int64]model.DocumentTable
	documentTableParts      map[int64]model.DocumentTableFragment
	documentTableCells      map[int64]model.DocumentTableCell
	extractionFacts         map[int64]model.ExtractionFact
	factSourceRefs          map[int64]model.FactSourceRef
	subjectAssets           map[int64]model.SubjectAsset
	assemblyItems           map[int64]model.AssemblyItem
	nextTemplateID          int64
	nextCaseID              int64
	nextEnterpriseProjectID int64
	nextCaseFileID          int64
	nextReportParseJobID    int64
	nextSliceID             int64
	nextTableID             int64
	nextTableFragmentID     int64
	nextTableCellID         int64
	nextFactID              int64
	nextSourceRefID         int64
	nextSubjectAssetID      int64
	nextAssemblyItemID      int64
}

func NewReportingRepository() ReportingRepository {
	now := time.Now().UTC()
	categories, _ := json.Marshal([]map[string]any{
		{"key": "subject", "name": "主体", "required": true},
		{"key": "region", "name": "区域", "required": true},
		{"key": "finance", "name": "财务", "required": true},
		{"key": "project", "name": "项目", "required": false},
		{"key": "counter_guarantee", "name": "反担保", "required": false},
	})
	config, _ := json.Marshal(map[string]any{
		"classificationMode": "manual_category+rule+ai_fallback",
		"reviewRequired":     true,
		"traceability":       true,
	})
	outline, _ := json.Marshal([]model.ReportTemplateOutlineNode{
		{ID: "line-1", Title: "模板说明", Level: 2, Line: 1},
	})

	return &reportingRepository{
		reportTemplates: map[int64]model.ReportTemplate{
			1: {
				BaseEntity:           model.BaseEntity{ID: 1, CreatedAt: now, UpdatedAt: now, CreatedBy: 1, UpdatedBy: 1},
				TemplateKey:          "default_report_pack",
				Name:                 "默认报告组装模板",
				Description:          "包含主体、区域、财务、项目、反担保五大类的最小模板",
				Status:               model.ReportTemplateStatusActive,
				DocFileID:            0,
				DocVersionNo:         0,
				CategoriesJSON:       categories,
				ProcessingConfigJSON: config,
				ContentMarkdown:      "## 模板说明\n\n请在此编辑报告模板内容。",
				OutlineJSON:          outline,
				EditorConfigJSON:     json.RawMessage(`{}`),
				AnnotationsJSON:      json.RawMessage(`[]`),
			},
		},
		reportCases:             map[int64]model.ReportCase{},
		enterpriseProjects:      map[int64]model.EnterpriseProject{},
		reportCaseFiles:         map[int64]model.ReportCaseFile{},
		reportParseJobs:         map[int64]model.ReportParseJob{},
		documentSlices:          map[int64]model.DocumentSlice{},
		documentTables:          map[int64]model.DocumentTable{},
		documentTableParts:      map[int64]model.DocumentTableFragment{},
		documentTableCells:      map[int64]model.DocumentTableCell{},
		extractionFacts:         map[int64]model.ExtractionFact{},
		factSourceRefs:          map[int64]model.FactSourceRef{},
		subjectAssets:           map[int64]model.SubjectAsset{},
		assemblyItems:           map[int64]model.AssemblyItem{},
		nextTemplateID:          2,
		nextCaseID:              1,
		nextEnterpriseProjectID: 1,
		nextCaseFileID:          1,
		nextReportParseJobID:    1,
		nextSliceID:             1,
		nextTableID:             1,
		nextTableFragmentID:     1,
		nextTableCellID:         1,
		nextFactID:              1,
		nextSourceRefID:         1,
		nextSubjectAssetID:      1,
		nextAssemblyItemID:      1,
	}
}

func (repository *reportingRepository) FindReportTemplateByID(templateID int64) (model.ReportTemplate, bool) {
	template, ok := repository.reportTemplates[templateID]
	return template, ok
}

func (repository *reportingRepository) FindReportTemplateByKey(templateKey string) (model.ReportTemplate, bool) {
	trimmed := strings.TrimSpace(templateKey)
	for _, template := range repository.reportTemplates {
		if template.TemplateKey == trimmed {
			return template, true
		}
	}
	return model.ReportTemplate{}, false
}

func (repository *reportingRepository) FindAllReportTemplates() []model.ReportTemplateDTO {
	ids := make([]int64, 0, len(repository.reportTemplates))
	for id := range repository.reportTemplates {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	out := make([]model.ReportTemplateDTO, 0, len(ids))
	for _, id := range ids {
		out = append(out, repository.reportTemplates[id].ToDTO())
	}
	return out
}

func (repository *reportingRepository) CreateReportTemplate(template model.ReportTemplate) model.ReportTemplateDTO {
	now := time.Now().UTC()
	template.ID = repository.nextTemplateID
	repository.nextTemplateID++
	template.CreatedAt = now
	template.UpdatedAt = now
	repository.reportTemplates[template.ID] = template
	return template.ToDTO()
}

func (repository *reportingRepository) UpdateReportTemplate(templateID int64, update model.ReportTemplate) (model.ReportTemplateDTO, bool) {
	entity, ok := repository.reportTemplates[templateID]
	if !ok {
		return model.ReportTemplateDTO{}, false
	}
	entity.Name = update.Name
	entity.Description = update.Description
	entity.Status = update.Status
	entity.DocFileID = update.DocFileID
	entity.DocVersionNo = update.DocVersionNo
	entity.CategoriesJSON = update.CategoriesJSON
	entity.ProcessingConfigJSON = update.ProcessingConfigJSON
	entity.ContentMarkdown = update.ContentMarkdown
	entity.OutlineJSON = update.OutlineJSON
	entity.EditorConfigJSON = update.EditorConfigJSON
	entity.AnnotationsJSON = update.AnnotationsJSON
	entity.UpdatedAt = time.Now().UTC()
	entity.UpdatedBy = update.UpdatedBy
	repository.reportTemplates[templateID] = entity
	return entity.ToDTO(), true
}

func (repository *reportingRepository) FindReportCaseByID(caseID int64) (model.ReportCase, bool) {
	entity, ok := repository.reportCases[caseID]
	return entity, ok
}

func (repository *reportingRepository) FindAllReportCases() []model.ReportCaseDTO {
	ids := make([]int64, 0, len(repository.reportCases))
	for id := range repository.reportCases {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] > ids[j] })
	out := make([]model.ReportCaseDTO, 0, len(ids))
	for _, id := range ids {
		out = append(out, repository.reportCases[id].ToDTO())
	}
	return out
}

func (repository *reportingRepository) CreateReportCase(reportCase model.ReportCase) model.ReportCaseDTO {
	now := time.Now().UTC()
	reportCase.ID = repository.nextCaseID
	repository.nextCaseID++
	reportCase.CreatedAt = now
	reportCase.UpdatedAt = now
	repository.reportCases[reportCase.ID] = reportCase
	return reportCase.ToDTO()
}

func (repository *reportingRepository) UpdateReportCase(reportCase model.ReportCase) (model.ReportCaseDTO, bool) {
	entity, ok := repository.reportCases[reportCase.ID]
	if !ok {
		return model.ReportCaseDTO{}, false
	}
	entity.TemplateID = reportCase.TemplateID
	entity.Name = reportCase.Name
	entity.SubjectID = reportCase.SubjectID
	entity.SubjectName = reportCase.SubjectName
	entity.Status = reportCase.Status
	entity.SummaryJSON = reportCase.SummaryJSON
	entity.UpdatedAt = time.Now().UTC()
	entity.UpdatedBy = reportCase.UpdatedBy
	repository.reportCases[entity.ID] = entity
	return entity.ToDTO(), true
}

func (repository *reportingRepository) FindEnterpriseProjectByID(projectID int64) (model.EnterpriseProject, bool) {
	entity, ok := repository.enterpriseProjects[projectID]
	return entity, ok
}

func (repository *reportingRepository) FindEnterpriseProjectsByEnterpriseID(enterpriseID int64) []model.EnterpriseProjectDTO {
	out := make([]model.EnterpriseProjectDTO, 0)
	for _, entity := range repository.enterpriseProjects {
		if enterpriseID <= 0 || entity.EnterpriseID == enterpriseID {
			out = append(out, entity.ToDTO())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

func (repository *reportingRepository) CreateEnterpriseProject(project model.EnterpriseProject) model.EnterpriseProjectDTO {
	now := time.Now().UTC()
	project.ID = repository.nextEnterpriseProjectID
	repository.nextEnterpriseProjectID++
	project.CreatedAt = now
	project.UpdatedAt = now
	repository.enterpriseProjects[project.ID] = project
	return project.ToDTO()
}

func (repository *reportingRepository) UpdateEnterpriseProject(project model.EnterpriseProject) (model.EnterpriseProjectDTO, bool) {
	entity, ok := repository.enterpriseProjects[project.ID]
	if !ok {
		return model.EnterpriseProjectDTO{}, false
	}
	entity.Name = project.Name
	entity.Status = project.Status
	entity.TemplateID = project.TemplateID
	entity.ReportCaseID = project.ReportCaseID
	entity.EnterpriseID = project.EnterpriseID
	entity.UpdatedAt = time.Now().UTC()
	entity.UpdatedBy = project.UpdatedBy
	repository.enterpriseProjects[entity.ID] = entity
	return entity.ToDTO(), true
}

func (repository *reportingRepository) CreateReportParseJob(job model.ReportParseJob) model.ReportParseJob {
	now := time.Now().UTC()
	job.ID = repository.nextReportParseJobID
	repository.nextReportParseJobID++
	job.CreatedAt = now
	job.UpdatedAt = now
	repository.reportParseJobs[job.ID] = job
	return job
}

func (repository *reportingRepository) FindReportParseJobsByProjectID(projectID int64) []model.ReportParseJob {
	out := make([]model.ReportParseJob, 0)
	for _, entity := range repository.reportParseJobs {
		if projectID <= 0 || entity.ProjectID == projectID {
			out = append(out, entity)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) FindReportParseJobByID(jobID int64) (model.ReportParseJob, bool) {
	entity, ok := repository.reportParseJobs[jobID]
	return entity, ok
}

func (repository *reportingRepository) ClaimNextReportParseJob(maxRetry int) (model.ReportParseJob, bool) {
	if maxRetry <= 0 {
		maxRetry = 3
	}
	var selected model.ReportParseJob
	found := false
	for _, job := range repository.reportParseJobs {
		if job.Status != model.ReportParseJobStatusPending && job.Status != model.ReportParseJobStatusFailed {
			continue
		}
		if job.RetryCount >= maxRetry {
			continue
		}
		if !found || job.UpdatedAt.Before(selected.UpdatedAt) || (job.UpdatedAt.Equal(selected.UpdatedAt) && job.ID < selected.ID) {
			selected = job
			found = true
		}
	}
	if !found {
		return model.ReportParseJob{}, false
	}
	now := time.Now().UTC()
	selected.Status = model.ReportParseJobStatusRunning
	selected.StartedAt = &now
	selected.UpdatedAt = now
	repository.reportParseJobs[selected.ID] = selected
	return selected, true
}

func (repository *reportingRepository) UpdateReportParseJob(job model.ReportParseJob) (model.ReportParseJob, bool) {
	entity, ok := repository.reportParseJobs[job.ID]
	if !ok {
		return model.ReportParseJob{}, false
	}
	entity.ProjectID = job.ProjectID
	entity.CaseID = job.CaseID
	entity.CaseFileID = job.CaseFileID
	entity.FileID = job.FileID
	entity.VersionNo = job.VersionNo
	entity.ManualCategory = job.ManualCategory
	entity.FileTypeGroup = job.FileTypeGroup
	entity.Status = job.Status
	entity.RetryCount = job.RetryCount
	entity.ErrorMessage = job.ErrorMessage
	entity.StartedAt = job.StartedAt
	entity.FinishedAt = job.FinishedAt
	entity.UpdatedAt = time.Now().UTC()
	repository.reportParseJobs[entity.ID] = entity
	return entity, true
}

func (repository *reportingRepository) DeleteReportParseJobsByCaseFileID(caseFileID int64) {
	for id, entity := range repository.reportParseJobs {
		if entity.CaseFileID == caseFileID {
			delete(repository.reportParseJobs, id)
		}
	}
}

func (repository *reportingRepository) FindReportCaseFiles(caseID int64) []model.ReportCaseFile {
	out := make([]model.ReportCaseFile, 0)
	for _, entity := range repository.reportCaseFiles {
		if entity.CaseID == caseID {
			out = append(out, entity)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) FindReportCaseFileByID(caseFileID int64) (model.ReportCaseFile, bool) {
	entity, ok := repository.reportCaseFiles[caseFileID]
	return entity, ok
}

func (repository *reportingRepository) FindReportCaseFile(caseID int64, fileID int64) (model.ReportCaseFile, bool) {
	for _, entity := range repository.reportCaseFiles {
		if entity.CaseID == caseID && entity.FileID == fileID {
			return entity, true
		}
	}
	return model.ReportCaseFile{}, false
}

func (repository *reportingRepository) CreateReportCaseFile(caseFile model.ReportCaseFile) model.ReportCaseFileDTO {
	now := time.Now().UTC()
	caseFile.ID = repository.nextCaseFileID
	repository.nextCaseFileID++
	caseFile.CreatedAt = now
	caseFile.UpdatedAt = now
	repository.reportCaseFiles[caseFile.ID] = caseFile
	return caseFile.ToDTO()
}

func (repository *reportingRepository) UpdateReportCaseFile(caseFile model.ReportCaseFile) (model.ReportCaseFileDTO, bool) {
	entity, ok := repository.reportCaseFiles[caseFile.ID]
	if !ok {
		return model.ReportCaseFileDTO{}, false
	}
	entity.VersionNo = caseFile.VersionNo
	entity.ManualCategory = caseFile.ManualCategory
	entity.SuggestedSubCategory = caseFile.SuggestedSubCategory
	entity.FinalSubCategory = caseFile.FinalSubCategory
	entity.Status = caseFile.Status
	entity.ReviewStatus = caseFile.ReviewStatus
	entity.Confidence = caseFile.Confidence
	entity.FileType = caseFile.FileType
	entity.SourceType = caseFile.SourceType
	entity.ParseStatus = caseFile.ParseStatus
	entity.OCRPending = caseFile.OCRPending
	entity.IsScannedSuspected = caseFile.IsScannedSuspected
	entity.ProcessingNotesJSON = caseFile.ProcessingNotesJSON
	entity.UpdatedAt = time.Now().UTC()
	entity.UpdatedBy = caseFile.UpdatedBy
	repository.reportCaseFiles[entity.ID] = entity
	return entity.ToDTO(), true
}

func (repository *reportingRepository) DeleteReportCaseFile(caseFileID int64) bool {
	if _, ok := repository.reportCaseFiles[caseFileID]; !ok {
		return false
	}
	delete(repository.reportCaseFiles, caseFileID)
	return true
}

func (repository *reportingRepository) DeleteSlicesByCaseFileID(caseFileID int64) {
	for id, entity := range repository.documentSlices {
		if entity.CaseFileID == caseFileID {
			delete(repository.documentSlices, id)
		}
	}
}

func (repository *reportingRepository) CreateDocumentSlice(slice model.DocumentSlice) model.DocumentSliceDTO {
	slice.ID = repository.nextSliceID
	repository.nextSliceID++
	slice.CreatedAt = time.Now().UTC()
	repository.documentSlices[slice.ID] = slice
	return slice.ToDTO()
}

func (repository *reportingRepository) FindDocumentSlicesByCaseID(caseID int64) []model.DocumentSliceDTO {
	out := make([]model.DocumentSliceDTO, 0)
	for _, caseFile := range repository.FindReportCaseFiles(caseID) {
		for _, slice := range repository.FindDocumentSlicesByCaseFileID(caseFile.ID) {
			out = append(out, slice.ToDTO())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) FindDocumentSlicesByCaseFileID(caseFileID int64) []model.DocumentSlice {
	out := make([]model.DocumentSlice, 0)
	for _, entity := range repository.documentSlices {
		if entity.CaseFileID == caseFileID {
			out = append(out, entity)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) DeleteTablesByCaseFileID(caseFileID int64) {
	for id, entity := range repository.documentTables {
		if entity.CaseFileID == caseFileID {
			delete(repository.documentTables, id)
		}
	}
	for id, entity := range repository.documentTableParts {
		if entity.CaseFileID == caseFileID {
			delete(repository.documentTableParts, id)
		}
	}
	for id, entity := range repository.documentTableCells {
		if entity.CaseFileID == caseFileID {
			delete(repository.documentTableCells, id)
		}
	}
}

func (repository *reportingRepository) CreateDocumentTable(table model.DocumentTable) model.DocumentTableDTO {
	table.ID = repository.nextTableID
	repository.nextTableID++
	table.CreatedAt = time.Now().UTC()
	repository.documentTables[table.ID] = table
	return table.ToDTO()
}

func (repository *reportingRepository) CreateDocumentTableFragment(fragment model.DocumentTableFragment) model.DocumentTableFragmentDTO {
	fragment.ID = repository.nextTableFragmentID
	repository.nextTableFragmentID++
	fragment.CreatedAt = time.Now().UTC()
	repository.documentTableParts[fragment.ID] = fragment
	return fragment.ToDTO()
}

func (repository *reportingRepository) CreateDocumentTableCell(cell model.DocumentTableCell) model.DocumentTableCellDTO {
	cell.ID = repository.nextTableCellID
	repository.nextTableCellID++
	cell.CreatedAt = time.Now().UTC()
	repository.documentTableCells[cell.ID] = cell
	return cell.ToDTO()
}

func (repository *reportingRepository) FindTablesByCaseID(caseID int64) []model.DocumentTableDTO {
	caseFileIDs := repository.caseFileIDSet(caseID)
	out := make([]model.DocumentTableDTO, 0)
	for _, entity := range repository.documentTables {
		if _, ok := caseFileIDs[entity.CaseFileID]; ok {
			out = append(out, entity.ToDTO())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) FindTableFragmentsByCaseID(caseID int64) []model.DocumentTableFragmentDTO {
	caseFileIDs := repository.caseFileIDSet(caseID)
	out := make([]model.DocumentTableFragmentDTO, 0)
	for _, entity := range repository.documentTableParts {
		if _, ok := caseFileIDs[entity.CaseFileID]; ok {
			out = append(out, entity.ToDTO())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) FindTableCellsByCaseID(caseID int64) []model.DocumentTableCellDTO {
	caseFileIDs := repository.caseFileIDSet(caseID)
	out := make([]model.DocumentTableCellDTO, 0)
	for _, entity := range repository.documentTableCells {
		if _, ok := caseFileIDs[entity.CaseFileID]; ok {
			out = append(out, entity.ToDTO())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) DeleteFactsByCaseFileID(caseFileID int64) []int64 {
	removed := make([]int64, 0)
	for id, entity := range repository.extractionFacts {
		if entity.CaseFileID == caseFileID {
			removed = append(removed, id)
			delete(repository.extractionFacts, id)
		}
	}
	return removed
}

func (repository *reportingRepository) CreateExtractionFact(fact model.ExtractionFact) model.ExtractionFactDTO {
	now := time.Now().UTC()
	fact.ID = repository.nextFactID
	repository.nextFactID++
	fact.CreatedAt = now
	fact.UpdatedAt = now
	repository.extractionFacts[fact.ID] = fact
	return fact.ToDTO()
}

func (repository *reportingRepository) UpdateExtractionFact(fact model.ExtractionFact) (model.ExtractionFactDTO, bool) {
	entity, ok := repository.extractionFacts[fact.ID]
	if !ok {
		return model.ExtractionFactDTO{}, false
	}
	entity.ReviewStatus = fact.ReviewStatus
	entity.NormalizedValueJSON = fact.NormalizedValueJSON
	entity.FactValueJSON = fact.FactValueJSON
	entity.UpdatedAt = time.Now().UTC()
	repository.extractionFacts[entity.ID] = entity
	return entity.ToDTO(), true
}

func (repository *reportingRepository) FindFactsByCaseID(caseID int64) []model.ExtractionFact {
	out := make([]model.ExtractionFact, 0)
	for _, entity := range repository.extractionFacts {
		if entity.CaseID == caseID {
			out = append(out, entity)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) FindFactsByCaseFileID(caseFileID int64) []model.ExtractionFact {
	out := make([]model.ExtractionFact, 0)
	for _, entity := range repository.extractionFacts {
		if entity.CaseFileID == caseFileID {
			out = append(out, entity)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (repository *reportingRepository) FindFactByID(factID int64) (model.ExtractionFact, bool) {
	entity, ok := repository.extractionFacts[factID]
	return entity, ok
}

func (repository *reportingRepository) DeleteSourceRefsByFactIDs(factIDs []int64) {
	if len(factIDs) == 0 {
		return
	}
	idSet := make(map[int64]struct{}, len(factIDs))
	for _, id := range factIDs {
		idSet[id] = struct{}{}
	}
	for id, ref := range repository.factSourceRefs {
		if _, ok := idSet[ref.FactID]; ok {
			delete(repository.factSourceRefs, id)
		}
	}
}

func (repository *reportingRepository) CreateFactSourceRef(ref model.FactSourceRef) model.FactSourceRefDTO {
	ref.ID = repository.nextSourceRefID
	repository.nextSourceRefID++
	ref.CreatedAt = time.Now().UTC()
	repository.factSourceRefs[ref.ID] = ref
	return ref.ToDTO()
}

func (repository *reportingRepository) FindSourceRefsByCaseID(caseID int64) []model.FactSourceRefDTO {
	facts := repository.FindFactsByCaseID(caseID)
	factIDs := make([]int64, 0, len(facts))
	for _, fact := range facts {
		factIDs = append(factIDs, fact.ID)
	}
	refs := repository.FindSourceRefsByFactIDs(factIDs)
	out := make([]model.FactSourceRefDTO, 0, len(refs))
	for _, ref := range refs {
		out = append(out, ref.ToDTO())
	}
	return out
}

func (repository *reportingRepository) FindSourceRefsByFactIDs(factIDs []int64) []model.FactSourceRef {
	if len(factIDs) == 0 {
		return nil
	}
	idSet := make(map[int64]struct{}, len(factIDs))
	for _, id := range factIDs {
		idSet[id] = struct{}{}
	}
	out := make([]model.FactSourceRef, 0)
	for _, ref := range repository.factSourceRefs {
		if _, ok := idSet[ref.FactID]; ok {
			out = append(out, ref)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].FactID == out[j].FactID {
			return out[i].SourceRank < out[j].SourceRank
		}
		return out[i].FactID < out[j].FactID
	})
	return out
}

func (repository *reportingRepository) DeleteAssemblyItemsByCaseID(caseID int64) {
	for id, item := range repository.assemblyItems {
		if item.CaseID == caseID {
			delete(repository.assemblyItems, id)
		}
	}
}

func (repository *reportingRepository) CreateAssemblyItem(item model.AssemblyItem) model.AssemblyItemDTO {
	now := time.Now().UTC()
	item.ID = repository.nextAssemblyItemID
	repository.nextAssemblyItemID++
	item.CreatedAt = now
	item.UpdatedAt = now
	repository.assemblyItems[item.ID] = item
	return item.ToDTO()
}

func (repository *reportingRepository) FindAssemblyItemsByCaseID(caseID int64) []model.AssemblyItemDTO {
	out := make([]model.AssemblyItemDTO, 0)
	for _, item := range repository.assemblyItems {
		if item.CaseID == caseID {
			out = append(out, item.ToDTO())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DisplayOrder < out[j].DisplayOrder })
	return out
}

func (repository *reportingRepository) FindSubjectAssets(subjectID int64) []model.SubjectAssetDTO {
	out := make([]model.SubjectAssetDTO, 0)
	for _, asset := range repository.subjectAssets {
		if subjectID <= 0 || asset.SubjectID == subjectID {
			out = append(out, asset.ToDTO())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

func (repository *reportingRepository) CreateSubjectAsset(asset model.SubjectAsset) model.SubjectAssetDTO {
	now := time.Now().UTC()
	asset.ID = repository.nextSubjectAssetID
	repository.nextSubjectAssetID++
	asset.CreatedAt = now
	asset.UpdatedAt = now
	repository.subjectAssets[asset.ID] = asset
	return asset.ToDTO()
}

func (repository *reportingRepository) caseFileIDSet(caseID int64) map[int64]struct{} {
	out := make(map[int64]struct{})
	for _, caseFile := range repository.FindReportCaseFiles(caseID) {
		out[caseFile.ID] = struct{}{}
	}
	return out
}
