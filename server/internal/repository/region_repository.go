package repository

import (
	"strconv"
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type RegionRepository interface {
	FindByID(regionID int64) (model.RegionDetailDTO, bool)
	FindByAdminCode(adminCode string) (model.RegionDetailDTO, bool)
	FindPage(query model.RegionListQuery) model.RegionPageResult
	Create(region model.Region, economies []model.RegionEconomy, ranks []model.RegionRank) model.RegionDetailDTO
	Update(regionID int64, region model.Region, economies []model.RegionEconomy, ranks []model.RegionRank) (model.RegionDetailDTO, bool)
	Delete(regionID int64) bool
	ListEconomies(regionID int64) ([]model.RegionEconomy, bool)
	CreateEconomy(regionID int64, economy model.RegionEconomy) (model.RegionEconomy, bool)
	UpdateEconomy(regionID int64, economyID int64, economy model.RegionEconomy) (model.RegionEconomy, bool)
	DeleteEconomy(regionID int64, economyID int64) bool
	ListRanks(regionID int64) ([]model.RegionRank, bool)
	CreateRank(regionID int64, rank model.RegionRank) (model.RegionRank, bool)
	UpdateRank(regionID int64, rankID int64, rank model.RegionRank) (model.RegionRank, bool)
	DeleteRank(regionID int64, rankID int64) bool
}

type regionRepository struct {
	regions        map[int64]model.Region
	economies      map[int64][]model.RegionEconomy
	ranks          map[int64][]model.RegionRank
	nextRegionID   int64
	nextEconomyID  int64
	nextRankID     int64
}

func NewRegionRepository() RegionRepository {
	now := time.Now().UTC()
	seed := model.Region{
		BaseEntity: model.BaseEntity{
			ID:        1,
			CreatedAt: now,
			UpdatedAt: now,
			CreatedBy: 1,
			UpdatedBy: 1,
		},
		AdminCode: "000000",
		Overview:  "默认区域",
	}
	return &regionRepository{
		regions: map[int64]model.Region{
			1: seed,
		},
		economies:     map[int64][]model.RegionEconomy{},
		ranks:         map[int64][]model.RegionRank{},
		nextRegionID:  2,
		nextEconomyID: 1,
		nextRankID:    1,
	}
}

func (repository *regionRepository) FindByID(regionID int64) (model.RegionDetailDTO, bool) {
	region, ok := repository.regions[regionID]
	if !ok {
		return model.RegionDetailDTO{}, false
	}
	return model.RegionDetailDTO{
		RegionDTO: region.ToDTO(),
		Economies: cloneEconomies(repository.economies[regionID]),
		Ranks:     cloneRanks(repository.ranks[regionID]),
	}, true
}

func (repository *regionRepository) FindByAdminCode(adminCode string) (model.RegionDetailDTO, bool) {
	trimmed := strings.TrimSpace(adminCode)
	if trimmed == "" {
		return model.RegionDetailDTO{}, false
	}
	for regionID, region := range repository.regions {
		if region.AdminCode == trimmed {
			return model.RegionDetailDTO{
				RegionDTO: region.ToDTO(),
				Economies: cloneEconomies(repository.economies[regionID]),
				Ranks:     cloneRanks(repository.ranks[regionID]),
			}, true
		}
	}
	return model.RegionDetailDTO{}, false
}

func (repository *regionRepository) FindPage(query model.RegionListQuery) model.RegionPageResult {
	keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
	filtered := make([]model.RegionDTO, 0, len(repository.regions))
	for _, region := range repository.regions {
		if keyword != "" {
			if !strings.Contains(strings.ToLower(region.AdminCode), keyword) && !strings.Contains(strings.ToLower(region.Overview), keyword) {
				continue
			}
		}
		filtered = append(filtered, region.ToDTO())
	}
	sort.Slice(filtered, func(i, j int) bool { return filtered[i].ID > filtered[j].ID })

	total := int64(len(filtered))
	start := (query.Page - 1) * query.PageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + query.PageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	items := []model.RegionDTO{}
	if start < end {
		items = filtered[start:end]
	}

	return model.RegionPageResult{
		Items:    items,
		Page:     query.Page,
		PageSize: query.PageSize,
		Total:    total,
	}
}

func (repository *regionRepository) Create(region model.Region, economies []model.RegionEconomy, ranks []model.RegionRank) model.RegionDetailDTO {
	now := time.Now().UTC()
	region.ID = repository.nextRegionID
	region.CreatedAt = now
	region.UpdatedAt = now
	repository.regions[region.ID] = region
	repository.nextRegionID++

	out := make([]model.RegionEconomy, 0, len(economies))
	yearSet := map[int]bool{}
	for _, item := range economies {
		if yearSet[item.Year] {
			continue
		}
		yearSet[item.Year] = true
		created, ok := repository.CreateEconomy(region.ID, item)
		if ok {
			out = append(out, created)
		}
	}
	outRanks := make([]model.RegionRank, 0, len(ranks))
	rankKeySet := map[string]bool{}
	for _, item := range ranks {
		key := rankUniqueKey(item.Year, item.Subject)
		if rankKeySet[key] {
			continue
		}
		rankKeySet[key] = true
		created, ok := repository.CreateRank(region.ID, item)
		if ok {
			outRanks = append(outRanks, created)
		}
	}

	return model.RegionDetailDTO{
		RegionDTO: region.ToDTO(),
		Economies: out,
		Ranks:     outRanks,
	}
}

func (repository *regionRepository) Update(regionID int64, region model.Region, economies []model.RegionEconomy, ranks []model.RegionRank) (model.RegionDetailDTO, bool) {
	existing, ok := repository.regions[regionID]
	if !ok {
		return model.RegionDetailDTO{}, false
	}
	existing.AdminCode = region.AdminCode
	existing.Overview = region.Overview
	existing.UpdatedBy = region.UpdatedBy
	existing.UpdatedAt = time.Now().UTC()
	repository.regions[regionID] = existing

	if economies != nil {
		repository.economies[regionID] = []model.RegionEconomy{}
		yearSet := map[int]bool{}
		for _, item := range economies {
			if yearSet[item.Year] {
				continue
			}
			yearSet[item.Year] = true
			_, _ = repository.CreateEconomy(regionID, item)
		}
	}
	if ranks != nil {
		repository.ranks[regionID] = []model.RegionRank{}
		rankKeySet := map[string]bool{}
		for _, item := range ranks {
			key := rankUniqueKey(item.Year, item.Subject)
			if rankKeySet[key] {
				continue
			}
			rankKeySet[key] = true
			_, _ = repository.CreateRank(regionID, item)
		}
	}

	return repository.FindByID(regionID)
}

func (repository *regionRepository) Delete(regionID int64) bool {
	if _, ok := repository.regions[regionID]; !ok {
		return false
	}
	delete(repository.regions, regionID)
	delete(repository.economies, regionID)
	delete(repository.ranks, regionID)
	return true
}

func (repository *regionRepository) ListEconomies(regionID int64) ([]model.RegionEconomy, bool) {
	if _, ok := repository.regions[regionID]; !ok {
		return nil, false
	}
	return cloneEconomies(repository.economies[regionID]), true
}

func (repository *regionRepository) CreateEconomy(regionID int64, economy model.RegionEconomy) (model.RegionEconomy, bool) {
	if _, ok := repository.regions[regionID]; !ok {
		return model.RegionEconomy{}, false
	}
	for _, existing := range repository.economies[regionID] {
		if existing.Year == economy.Year {
			return model.RegionEconomy{}, false
		}
	}
	now := time.Now().UTC()
	economy.ID = repository.nextEconomyID
	economy.RegionID = regionID
	economy.CreatedAt = now
	economy.UpdatedAt = now
	repository.nextEconomyID++
	repository.economies[regionID] = append(repository.economies[regionID], economy)
	sort.Slice(repository.economies[regionID], func(i, j int) bool {
		return repository.economies[regionID][i].Year > repository.economies[regionID][j].Year
	})
	return economy, true
}

func (repository *regionRepository) UpdateEconomy(regionID int64, economyID int64, economy model.RegionEconomy) (model.RegionEconomy, bool) {
	rows, ok := repository.economies[regionID]
	if !ok {
		return model.RegionEconomy{}, false
	}
	for i, item := range rows {
		if item.ID != economyID {
			continue
		}
		for _, other := range rows {
			if other.ID != economyID && other.Year == economy.Year {
				return model.RegionEconomy{}, false
			}
		}
		economy.ID = economyID
		economy.RegionID = regionID
		economy.CreatedAt = item.CreatedAt
		economy.CreatedBy = item.CreatedBy
		economy.UpdatedAt = time.Now().UTC()
		rows[i] = economy
		repository.economies[regionID] = rows
		sort.Slice(repository.economies[regionID], func(i, j int) bool {
			return repository.economies[regionID][i].Year > repository.economies[regionID][j].Year
		})
		return economy, true
	}
	return model.RegionEconomy{}, false
}

func (repository *regionRepository) DeleteEconomy(regionID int64, economyID int64) bool {
	rows, ok := repository.economies[regionID]
	if !ok {
		return false
	}
	out := make([]model.RegionEconomy, 0, len(rows))
	deleted := false
	for _, item := range rows {
		if item.ID == economyID {
			deleted = true
			continue
		}
		out = append(out, item)
	}
	if !deleted {
		return false
	}
	repository.economies[regionID] = out
	return true
}

func (repository *regionRepository) ListRanks(regionID int64) ([]model.RegionRank, bool) {
	if _, ok := repository.regions[regionID]; !ok {
		return nil, false
	}
	return cloneRanks(repository.ranks[regionID]), true
}

func (repository *regionRepository) CreateRank(regionID int64, rank model.RegionRank) (model.RegionRank, bool) {
	if _, ok := repository.regions[regionID]; !ok {
		return model.RegionRank{}, false
	}
	for _, existing := range repository.ranks[regionID] {
		if existing.Year == rank.Year && strings.EqualFold(strings.TrimSpace(existing.Subject), strings.TrimSpace(rank.Subject)) {
			return model.RegionRank{}, false
		}
	}
	now := time.Now().UTC()
	rank.ID = repository.nextRankID
	rank.RegionID = regionID
	rank.CreatedAt = now
	rank.UpdatedAt = now
	rank.Subject = strings.TrimSpace(rank.Subject)
	repository.nextRankID++
	repository.ranks[regionID] = append(repository.ranks[regionID], rank)
	sort.Slice(repository.ranks[regionID], func(i, j int) bool {
		if repository.ranks[regionID][i].Year == repository.ranks[regionID][j].Year {
			return repository.ranks[regionID][i].ID > repository.ranks[regionID][j].ID
		}
		return repository.ranks[regionID][i].Year > repository.ranks[regionID][j].Year
	})
	return rank, true
}

func (repository *regionRepository) UpdateRank(regionID int64, rankID int64, rank model.RegionRank) (model.RegionRank, bool) {
	rows, ok := repository.ranks[regionID]
	if !ok {
		return model.RegionRank{}, false
	}
	trimmedSubject := strings.TrimSpace(rank.Subject)
	for i, item := range rows {
		if item.ID != rankID {
			continue
		}
		for _, other := range rows {
			if other.ID == rankID {
				continue
			}
			if other.Year == rank.Year && strings.EqualFold(strings.TrimSpace(other.Subject), trimmedSubject) {
				return model.RegionRank{}, false
			}
		}
		rank.ID = rankID
		rank.RegionID = regionID
		rank.Subject = trimmedSubject
		rank.CreatedAt = item.CreatedAt
		rank.CreatedBy = item.CreatedBy
		rank.UpdatedAt = time.Now().UTC()
		rows[i] = rank
		repository.ranks[regionID] = rows
		sort.Slice(repository.ranks[regionID], func(i, j int) bool {
			if repository.ranks[regionID][i].Year == repository.ranks[regionID][j].Year {
				return repository.ranks[regionID][i].ID > repository.ranks[regionID][j].ID
			}
			return repository.ranks[regionID][i].Year > repository.ranks[regionID][j].Year
		})
		return rank, true
	}
	return model.RegionRank{}, false
}

func (repository *regionRepository) DeleteRank(regionID int64, rankID int64) bool {
	rows, ok := repository.ranks[regionID]
	if !ok {
		return false
	}
	out := make([]model.RegionRank, 0, len(rows))
	deleted := false
	for _, item := range rows {
		if item.ID == rankID {
			deleted = true
			continue
		}
		out = append(out, item)
	}
	if !deleted {
		return false
	}
	repository.ranks[regionID] = out
	return true
}

func cloneEconomies(source []model.RegionEconomy) []model.RegionEconomy {
	out := make([]model.RegionEconomy, 0, len(source))
	out = append(out, source...)
	return out
}

func cloneRanks(source []model.RegionRank) []model.RegionRank {
	out := make([]model.RegionRank, 0, len(source))
	out = append(out, source...)
	return out
}

func rankUniqueKey(year int, subject string) string {
	return strconv.Itoa(year) + "::" + strings.ToLower(strings.TrimSpace(subject))
}
