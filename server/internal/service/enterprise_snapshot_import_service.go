package service

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
)

func (service *enterpriseService) ImportSnapshot(_ context.Context, request model.SnapshotEntpImportRequest, operatorID int64) (model.EnterpriseSnapshotImportResult, *model.APIError) {
	var entp map[string]any
	if err := json.Unmarshal(request.Snapshot, &entp); err != nil {
		return model.EnterpriseSnapshotImportResult{}, model.NewAPIError(400, response.CodeBadRequest, "snapshot 不是合法 JSON")
	}
	createReq, result := service.mapSnapshotToCreateRequest(request, entp)
	if createReq.ShortName == "" || createReq.UnifiedCreditCode == "" {
		return result, model.NewAPIError(400, response.CodeBadRequest, "快照缺少 shortName/unifiedCreditCode")
	}
	if existing, ok := service.repository.FindByUnifiedCreditCode(createReq.UnifiedCreditCode); ok {
		result.EnterpriseID = existing.ID
		if existing.ShortName != createReq.ShortName {
			result.Conflicts = append(result.Conflicts, model.ConflictDifference{FieldPath: "shortName", ExistingValue: existing.ShortName, IncomingValue: createReq.ShortName, Reason: "统一信用代码相同但企业简称不同"})
		}
		if existing.RegionID != createReq.RegionID && createReq.RegionID > 0 {
			result.Conflicts = append(result.Conflicts, model.ConflictDifference{FieldPath: "regionId", ExistingValue: existing.RegionID, IncomingValue: createReq.RegionID, Reason: "区域不一致"})
		}
		if request.DryRun || (!request.Confirm && len(result.Conflicts) > 0) {
			return result, nil
		}
		updated, apiErr := service.Update(context.Background(), existing.ID, model.UpdateEnterpriseRequest(createReq), operatorID)
		if apiErr != nil {
			return result, apiErr
		}
		result.EnterpriseID = updated.ID
		result.Updated = true
		return result, nil
	}
	if request.DryRun {
		return result, nil
	}
	created, apiErr := service.Create(context.Background(), createReq, operatorID)
	if apiErr != nil {
		return result, apiErr
	}
	result.EnterpriseID = created.ID
	result.Created = true
	return result, nil
}

func (service *enterpriseService) mapSnapshotToCreateRequest(request model.SnapshotEntpImportRequest, entp map[string]any) (model.CreateEnterpriseRequest, model.EnterpriseSnapshotImportResult) {
	result := model.EnterpriseSnapshotImportResult{Conflicts: []model.ConflictDifference{}, Warnings: []string{}}
	raw, _ := json.Marshal(entp)
	req := model.CreateEnterpriseRequest{
		ShortName:         stringValue(entp["shortName"], entp["name"], entp["entp_name"]),
		UnifiedCreditCode: stringValue(entp["unifiedCreditCode"], entp["creditCode"], entp["socialCreditCode"]),
		AdmissionStatus:   model.NormalizeEnterpriseAdmissionStatus(stringValue(entp["admissionStatus"])),
		LegalPerson:       stringValue(entp["legalPerson"]),
		Industry:          stringValue(entp["industry"]),
		Address:           stringValue(entp["address"]),
		BusinessScope:     stringValue(entp["businessScope"]),
		CompanyType:       stringValue(entp["companyType"]),
		EnterpriseNature:  stringValue(entp["enterpriseNature"]),
		FinanceSnapshot:   &model.EnterpriseFinanceSnapshot{},
		SnapshotExtension: &model.EnterpriseSnapshotExtension{SourceSnapshotID: request.SnapshotID, RawEntpJSON: string(raw), NormalizedExtraJSON: string(raw)},
	}
	req.ActualController = strings.Join(stringArray(entp["actualController"]), ";")
	req.ActualControllerControlPath = strings.Join(stringArray(entp["actualControllerControlPath"]), ";")
	req.IssuerRating = strings.Join(stringArray(entp["issuerRating"]), ";")
	req.IssuerRatingAgency = strings.Join(stringArray(entp["issuerRatingAgency"]), ";")
	req.BondDetails = parseBondDetails(entp["bondDetails"], &result)
	req.BondTenders = parseBondTenders(entp["bondTenders"], &result)
	req.BondRegistrations = parseBondRegistrations(entp["bondRegistrations"])
	req.PublicOpinions = parsePublicOpinions(entp["publicOpinions"])
	req.Tags = parseTags(entp["tags"])
	req.FinanceSubjects = parseFinanceSubjects(entp["enterprise_finance_subject"])
	req.Shareholders = parseShareholders(entp["shareholders"])
	req.FinancialReports, req.FinancialReportItems = parseFinancialReports(entp["enterprise_financial_report"], entp["enterprise_financial_report_item"], &result)
	if capital, ok := parseCapital(entp["registeredCapital"]); ok {
		req.RegisteredCapital = &capital
		result.FieldStats.Written++
	} else {
		result.FieldStats.Skipped++
	}
	if regionID := int64Value(entp["regionId"]); regionID > 0 {
		req.RegionID = regionID
	} else if code := stringValue(entp["regionAdminCode"]); code != "" {
		if region, exists := service.regionRepository.FindByAdminCode(code); exists {
			req.RegionID = region.ID
		}
	}
	if req.RegionID <= 0 {
		if defaultRegion, exists := service.regionRepository.FindByAdminCode("000000"); exists {
			req.RegionID = defaultRegion.ID
			result.Warnings = append(result.Warnings, "region 缺失，已回退默认 000000")
		}
	}
	return req, result
}

func stringValue(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		}
	}
	return ""
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case string:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return parsed
	default:
		return 0
	}
}

func parseCapital(value any) (float64, bool) {
	raw := strings.ReplaceAll(strings.ReplaceAll(stringValue(value), ",", ""), " ", "")
	if raw == "" || raw == "-" {
		return 0, false
	}
	multiplier := 1.0
	raw = strings.ReplaceAll(raw, "元", "")
	if strings.Contains(raw, "亿元") || strings.Contains(raw, "亿") {
		multiplier = 100000000
		raw = strings.ReplaceAll(strings.ReplaceAll(raw, "亿元", ""), "亿", "")
	}
	if strings.Contains(raw, "万元") || strings.Contains(raw, "万") {
		multiplier = 10000
		raw = strings.ReplaceAll(strings.ReplaceAll(raw, "万元", ""), "万", "")
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, false
	}
	return parsed * multiplier, true
}

func stringArray(value any) []string {
	arr, ok := value.([]any)
	if !ok {
		s := stringValue(value)
		if s == "" {
			return []string{}
		}
		return []string{s}
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		if s := stringValue(item); s != "" {
			result = append(result, s)
		}
	}
	return result
}

func parseFinancialReports(reportValue, itemValue any, result *model.EnterpriseSnapshotImportResult) ([]model.EnterpriseFinancialReport, []model.EnterpriseFinancialReportItem) {
	_ = result
	reports := []model.EnterpriseFinancialReport{}
	items := []model.EnterpriseFinancialReportItem{}
	reportArr, _ := reportValue.([]any)
	for _, row := range reportArr {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		reports = append(reports, model.EnterpriseFinancialReport{
			Year:           int(int64Value(m["year"])),
			Month:          int(int64Value(m["month"])),
			Level:          int(int64Value(m["level"])),
			AccountingFirm: stringValue(m["accountingFirm"]),
			ReportName:     stringValue(m["report_name"]),
			ReportType:     stringValue(m["report_type"]),
			ReportDate:     stringValue(m["report_date"]),
		})
	}
	itemArr, _ := itemValue.([]any)
	for i, row := range itemArr {
		m, ok := row.(map[string]any)
		if !ok {
			continue
		}
		value, okValue := parseCapital(m["value"])
		var ptr *float64
		if okValue {
			ptr = &value
		}
		items = append(items, model.EnterpriseFinancialReportItem{
			FinancialReportID: int64Value(m["financial_report_id"]),
			SubjectID:         int64Value(m["subject_id"]),
			OrderNo:           i + 1,
			Value:             ptr,
		})
	}
	return reports, items
}

func parseBondDetails(value any, result *model.EnterpriseSnapshotImportResult) []model.EnterpriseBondDetail {
	if value == nil {
		result.Warnings = append(result.Warnings, "bondDetails 为 null，按空集合处理")
		return []model.EnterpriseBondDetail{}
	}
	return []model.EnterpriseBondDetail{}
}
func parseBondTenders(value any, result *model.EnterpriseSnapshotImportResult) []model.EnterpriseBondTender {
	if value == nil {
		result.Warnings = append(result.Warnings, "bondTenders 为 null，按空集合处理")
	}
	return []model.EnterpriseBondTender{}
}
func parseBondRegistrations(_ any) []model.EnterpriseBondRegistration { return []model.EnterpriseBondRegistration{} }
func parsePublicOpinions(_ any) []model.EnterprisePublicOpinion       { return []model.EnterprisePublicOpinion{} }
func parseTags(_ any) []model.EnterpriseTag                           { return []model.EnterpriseTag{} }
func parseFinanceSubjects(_ any) []model.EnterpriseFinanceSubject     { return []model.EnterpriseFinanceSubject{} }
func parseShareholders(_ any) []model.EnterpriseShareholder           { return []model.EnterpriseShareholder{} }
