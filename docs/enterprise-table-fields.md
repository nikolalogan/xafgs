# 企业域数据表字段说明（完整）

> 数据来源：`server/internal/db/migrate.go` 中企业相关建表语句。

## 1) `enterprise`（企业主表）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 企业主键 ID |
| `short_name` | `VARCHAR(256)` | `NOT NULL` | 企业简称 |
| `region_id` | `BIGINT` | `NOT NULL`，外键 `region(id)` | 所属地区 ID |
| `in_hidden_debt_list` | `BOOLEAN` | `NOT NULL DEFAULT false` | 是否在隐性债务名单 |
| `in_3899_list` | `BOOLEAN` | `NOT NULL DEFAULT false` | 是否在 3899 名单 |
| `meets_335_indicator` | `BOOLEAN` | `NOT NULL DEFAULT false` | 是否满足 335 指标 |
| `meets_224_indicator` | `BOOLEAN` | `NOT NULL DEFAULT false` | 是否满足 224 指标 |
| `enterprise_level` | `VARCHAR(64)` | `NOT NULL DEFAULT ''` | 企业分级 |
| `net_assets` | `NUMERIC(20,4)` | 可空 | 净资产 |
| `real_estate_revenue_ratio` | `NUMERIC(12,6)` | 可空 | 地产收入占比 |
| `main_business_type` | `TEXT` | `NOT NULL DEFAULT ''` | 主营业务类型 |
| `established_at` | `TIMESTAMPTZ` | 可空 | 成立时间 |
| `non_standard_financing_ratio` | `NUMERIC(12,6)` | 可空 | 非标融资占比 |
| `main_business` | `TEXT` | `NOT NULL DEFAULT ''` | 主营业务描述 |
| `related_party_public_opinion` | `TEXT` | `NOT NULL DEFAULT ''` | 关联方舆情说明 |
| `admission_status` | `BOOLEAN` | `NOT NULL DEFAULT false` | 是否准入 |
| `calculated_at` | `TIMESTAMPTZ` | 可空 | 指标计算时间 |
| `registered_capital` | `NUMERIC(20,4)` | 可空 | 注册资本 |
| `paid_in_capital` | `NUMERIC(20,4)` | 可空 | 实缴资本 |
| `industry` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 所属行业 |
| `address` | `TEXT` | `NOT NULL DEFAULT ''` | 企业地址 |
| `business_scope` | `TEXT` | `NOT NULL DEFAULT ''` | 经营范围 |
| `legal_person` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 法定代表人 |
| `company_type` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 公司类型 |
| `enterprise_nature` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 企业性质 |
| `actual_controller` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 实际控制人 |
| `actual_controller_control_path` | `TEXT` | `NOT NULL DEFAULT ''` | 实控路径/股权穿透路径 |
| `issuer_rating` | `VARCHAR(64)` | `NOT NULL DEFAULT ''` | 发行主体评级 |
| `issuer_rating_agency` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 评级机构 |
| `unified_credit_code` | `VARCHAR(64)` | `NOT NULL` | 统一社会信用代码 |
| `legal_person_id_card` | `VARCHAR(64)` | `NOT NULL DEFAULT ''` | 法人身份证号 |
| `status` | `VARCHAR(32)` | `NOT NULL DEFAULT 'active'`，`CHECK (active/deleted)` | 记录状态（有效/删除） |
| `deleted_at` | `TIMESTAMPTZ` | 可空 | 软删除时间 |
| `deleted_by` | `BIGINT` | 可空 | 软删除操作人 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 更新时间 |
| `created_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 创建人 ID |
| `updated_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 更新人 ID |

## 2) `enterprise_tag`（企业标签）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 标签记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键 `enterprise(id)`，`ON DELETE CASCADE` | 所属企业 ID |
| `title` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 标签标题 |
| `order_no` | `INT` | `NOT NULL DEFAULT 1` | 排序号 |

## 3) `enterprise_public_opinion`（企业舆情）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 舆情记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`ON DELETE CASCADE` | 所属企业 ID |
| `source` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 舆情来源 |
| `issue` | `TEXT` | `NOT NULL DEFAULT ''` | 舆情问题/摘要 |
| `opinion_time` | `TIMESTAMPTZ` | 可空 | 舆情发生时间 |
| `title` | `VARCHAR(512)` | `NOT NULL DEFAULT ''` | 舆情标题 |
| `order_no` | `INT` | `NOT NULL DEFAULT 1` | 排序号 |

## 4) `enterprise_bond_tender`（企业招投标）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 招投标记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`ON DELETE CASCADE` | 所属企业 ID |
| `tender_time` | `TIMESTAMPTZ` | 可空 | 招投标时间 |
| `tender_type` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 招标类型 |
| `project_type` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 项目类型 |
| `winner` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 中标方 |
| `tender_title` | `VARCHAR(512)` | `NOT NULL DEFAULT ''` | 招投标标题 |
| `order_no` | `INT` | `NOT NULL DEFAULT 1` | 排序号 |

## 5) `enterprise_bond_detail`（企业债券明细）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 债券明细记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`ON DELETE CASCADE` | 所属企业 ID |
| `short_name` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 债券简称 |
| `bond_code` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 债券代码 |
| `bond_type` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 债券类型 |
| `balance` | `NUMERIC(20,4)` | 可空 | 债券余额 |
| `bond_term` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 债券期限 |
| `rating` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 债项评级 |
| `guarantor` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 担保方 |
| `guarantor_type` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 担保类型 |
| `issue_time` | `TIMESTAMPTZ` | 可空 | 发行时间 |
| `issue_rate` | `NUMERIC(12,6)` | 可空 | 发行利率 |
| `maturity_date` | `TIMESTAMPTZ` | 可空 | 到期日期 |
| `usefor` | `TEXT` | `NOT NULL DEFAULT ''` | 用途 |
| `order_no` | `INT` | `NOT NULL DEFAULT 1` | 排序号 |

## 6) `enterprise_bond_registration`（企业发债注册）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 注册记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`ON DELETE CASCADE` | 所属企业 ID |
| `project_name` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 项目名称 |
| `registration_status` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 注册状态 |
| `status_updated_at` | `TIMESTAMPTZ` | 可空 | 状态更新时间 |
| `amount` | `NUMERIC(20,4)` | 可空 | 注册金额 |
| `process` | `TEXT` | `NOT NULL DEFAULT ''` | 进展说明 |
| `order_no` | `INT` | `NOT NULL DEFAULT 1` | 排序号 |

## 7) `enterprise_finance_snapshot`（企业财务快照）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 财务快照记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`UNIQUE`，`ON DELETE CASCADE` | 所属企业 ID（每企业一条快照） |
| `liability_asset_ratio` | `NUMERIC(12,6)` | 可空 | 资产负债率 |
| `roa` | `NUMERIC(12,6)` | 可空 | 总资产收益率 |
| `roa_industry_median` | `NUMERIC(12,6)` | 可空 | 行业总资产收益率中位数 |
| `roa_industry_1_4` | `NUMERIC(12,6)` | 可空 | 行业总资产收益率 1/4 分位 |
| `roa_industry_3_4` | `NUMERIC(12,6)` | 可空 | 行业总资产收益率 3/4 分位 |
| `roe` | `NUMERIC(12,6)` | 可空 | 净资产收益率 |
| `roe_industry_1_4` | `NUMERIC(12,6)` | 可空 | 行业净资产收益率 1/4 分位 |
| `roe_industry_3_4` | `NUMERIC(12,6)` | 可空 | 行业净资产收益率 3/4 分位 |
| `interest_coverage` | `NUMERIC(12,6)` | 可空 | 利息保障倍数 |
| `ebit_coverage` | `NUMERIC(12,6)` | 可空 | EBIT 保障倍数 |
| `ebit_coverage_industry_median` | `NUMERIC(12,6)` | 可空 | EBIT 保障倍数中位数 |
| `ebit_coverage_industry_1_4` | `NUMERIC(12,6)` | 可空 | EBIT 保障倍数 1/4 分位 |
| `ebit_coverage_industry_3_4` | `NUMERIC(12,6)` | 可空 | EBIT 保障倍数 3/4 分位 |
| `ebitda_coverage` | `NUMERIC(12,6)` | 可空 | EBITDA 保障倍数 |
| `ebitda_coverage_industry_median` | `NUMERIC(12,6)` | 可空 | EBITDA 保障倍数中位数 |
| `ebitda_coverage_industry_1_4` | `NUMERIC(12,6)` | 可空 | EBITDA 保障倍数 1/4 分位 |
| `ebitda_coverage_industry_3_4` | `NUMERIC(12,6)` | 可空 | EBITDA 保障倍数 3/4 分位 |
| `liability_asset_ratio_industry_median` | `NUMERIC(12,6)` | 可空 | 行业资产负债率中位数 |
| `liability_asset_ratio_industry_1_4` | `NUMERIC(12,6)` | 可空 | 行业资产负债率 1/4 分位 |
| `liability_asset_ratio_industry_3_4` | `NUMERIC(12,6)` | 可空 | 行业资产负债率 3/4 分位 |
| `roe_industry_median` | `NUMERIC(12,6)` | 可空 | 行业净资产收益率中位数 |
| `non_standard_financing_ratio_industry_median` | `NUMERIC(12,6)` | 可空 | 行业非标融资占比中位数 |
| `main_business_1` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 主营业务 1 |
| `main_business_2` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 主营业务 2 |
| `main_business_3` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 主营业务 3 |
| `main_business_4` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 主营业务 4 |
| `main_business_5` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 主营业务 5 |
| `main_business_ratio_1` | `NUMERIC(12,6)` | 可空 | 主营业务 1 占比 |
| `main_business_ratio_2` | `NUMERIC(12,6)` | 可空 | 主营业务 2 占比 |
| `main_business_ratio_3` | `NUMERIC(12,6)` | 可空 | 主营业务 3 占比 |
| `main_business_ratio_4` | `NUMERIC(12,6)` | 可空 | 主营业务 4 占比 |
| `main_business_ratio_5` | `NUMERIC(12,6)` | 可空 | 主营业务 5 占比 |

## 8) `enterprise_finance_subject`（企业财务科目）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 财务科目记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`ON DELETE CASCADE` | 所属企业 ID |
| `subject_name` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 科目名称 |
| `subject_type` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 科目类别（如资产负债表/利润表） |
| `order_no` | `INT` | `NOT NULL DEFAULT 1` | 排序号 |

## 9) `enterprise_shareholder`（企业股东）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 股东记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`ON DELETE CASCADE` | 所属企业 ID |
| `shareholder_id` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 股东标识 |
| `order_no` | `INT` | `NOT NULL DEFAULT 1` | 排序号 |

## 10) `enterprise_financial_report`（企业财报）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 财报记录 ID |
| `enterprise_id` | `BIGINT` | `NOT NULL`，外键，`ON DELETE CASCADE` | 所属企业 ID |
| `year` | `INT` | `NOT NULL`，`CHECK (year >= 1900)` | 财报年份 |
| `month` | `INT` | `NOT NULL`，`CHECK (1~12)` | 财报月份 |
| `level` | `INT` | `NOT NULL DEFAULT 1`，`CHECK (level >= 1)` | 财报层级 |
| `accounting_firm` | `VARCHAR(256)` | `NOT NULL DEFAULT ''` | 会计师事务所 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 更新时间 |
| `created_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 创建人 ID |
| `updated_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 更新人 ID |

> 复合唯一约束：`UNIQUE (enterprise_id, year, month)`。

## 11) `enterprise_financial_report_item`（企业财报科目值）

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 财报明细记录 ID |
| `financial_report_id` | `BIGINT` | `NOT NULL`，外键 `enterprise_financial_report(id)`，`ON DELETE CASCADE` | 所属财报 ID |
| `subject_id` | `BIGINT` | `NOT NULL`，外键 `enterprise_finance_subject(id)`，`ON DELETE RESTRICT` | 财务科目 ID |
| `value` | `NUMERIC(20,4)` | 可空 | 科目值 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 更新时间 |
| `created_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 创建人 ID |
| `updated_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 更新人 ID |

> 复合唯一约束：`UNIQUE (financial_report_id, subject_id)`。

## 文本版 ER 关系清单（企业主表 -> 各子表/区域表）

```text
enterprise (id)
├─(1:N) enterprise_tag.enterprise_id
├─(1:N) enterprise_public_opinion.enterprise_id
├─(1:N) enterprise_bond_tender.enterprise_id
├─(1:N) enterprise_bond_detail.enterprise_id
├─(1:N) enterprise_bond_registration.enterprise_id
├─(1:1) enterprise_finance_snapshot.enterprise_id (UNIQUE)
├─(1:N) enterprise_finance_subject.enterprise_id
├─(1:N) enterprise_shareholder.enterprise_id
├─(1:N) enterprise_financial_report.enterprise_id
│   └─(1:N) enterprise_financial_report_item.financial_report_id
│       └─(N:1) enterprise_finance_subject.id (subject_id, RESTRICT)
└─(N:1) region.id (enterprise.region_id)
    └─(1:N) region_economy.region_id
    └─(1:N) region_rank.region_id
```

## 12) `region`（企业关联区域主表）

> 关联关系：`enterprise.region_id -> region.id`。

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 区域主键 ID |
| `admin_code` | `VARCHAR(64)` | `NOT NULL UNIQUE` | 行政区划代码 |
| `overview` | `TEXT` | `NOT NULL DEFAULT ''` | 区域概述 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 更新时间 |
| `created_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 创建人 ID |
| `updated_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 更新人 ID |

## 13) `region_economy`（企业关联区域经济指标表）

> 关联关系：`region_economy.region_id -> region.id`，并通过 `enterprise.region_id` 与企业建立区域经济关联。

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 区域经济记录 ID |
| `region_id` | `BIGINT` | `NOT NULL`，外键 `region(id)`，`ON DELETE CASCADE` | 区域 ID |
| `is_top100_county` | `BOOLEAN` | `NOT NULL DEFAULT false` | 是否百强县 |
| `is_top100_city` | `BOOLEAN` | `NOT NULL DEFAULT false` | 是否百强市 |
| `gdp` | `NUMERIC(20,4)` | 可空 | GDP 总量 |
| `gdp_growth` | `NUMERIC(12,6)` | 可空 | GDP 增速 |
| `population` | `NUMERIC(20,4)` | 可空 | 常住人口 |
| `fiscal_self_sufficiency_ratio` | `NUMERIC(12,6)` | 可空 | 财政自给率 |
| `general_budget_revenue` | `NUMERIC(20,4)` | 可空 | 一般公共预算收入 |
| `general_budget_revenue_growth` | `NUMERIC(12,6)` | 可空 | 一般公共预算收入增速 |
| `general_budget_revenue_total` | `NUMERIC(20,4)` | 可空 | 一般公共预算收入（累计） |
| `general_budget_revenue_tax` | `NUMERIC(20,4)` | 可空 | 税收收入 |
| `general_budget_revenue_non_tax` | `NUMERIC(20,4)` | 可空 | 非税收入 |
| `general_budget_revenue_superior_subsidy` | `NUMERIC(20,4)` | 可空 | 上级补助收入 |
| `liability_ratio` | `NUMERIC(12,6)` | 可空 | 负债率 |
| `liability_ratio_broad` | `NUMERIC(12,6)` | 可空 | 广义负债率 |
| `debt_ratio` | `NUMERIC(12,6)` | 可空 | 债务率 |
| `debt_ratio_broad` | `NUMERIC(12,6)` | 可空 | 广义债务率 |
| `year` | `INT` | `NOT NULL`，`CHECK (year >= 1900)` | 统计年份 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 更新时间 |
| `created_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 创建人 ID |
| `updated_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 更新人 ID |

> 复合唯一约束：`UNIQUE (region_id, year)`。

## 14) `region_rank`（企业关联区域排名表）

> 关联关系：`region_rank.region_id -> region.id`，并通过 `enterprise.region_id` 与企业建立区域排名关联。

| 字段名 | 类型 | 约束/默认值 | 字段含义 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 区域排名记录 ID |
| `region_id` | `BIGINT` | `NOT NULL`，外键 `region(id)`，`ON DELETE CASCADE` | 区域 ID |
| `subject` | `VARCHAR(128)` | `NOT NULL DEFAULT ''` | 科目 |
| `rank` | `INT` | 可空 | 排名 |
| `total` | `INT` | 可空 | 总数 |
| `year` | `INT` | `NOT NULL`，`CHECK (year >= 1900)` | 统计年份 |
| `growth_rate` | `NUMERIC(12,6)` | 可空 | 增长率 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 更新时间 |
| `created_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 创建人 ID |
| `updated_by` | `BIGINT` | `NOT NULL DEFAULT 0` | 更新人 ID |

> 复合唯一约束：`UNIQUE (region_id, year, subject)`。

## 关键索引说明

- `idx_enterprise_credit_code_active`：`enterprise(unified_credit_code)` 部分唯一索引（`deleted_at IS NULL`），保证未删除企业信用代码唯一。
- `idx_enterprise_region_id`：按地区查询企业。
- `idx_enterprise_admission_status`：按准入状态筛选企业。
- `idx_enterprise_updated_at`：按更新时间倒序检索企业。
- `idx_enterprise_*_enterprise_order`：各子表按企业 + 排序号查询。
- `idx_enterprise_financial_report_enterprise_year_month`：企业财报按年月查询。
- `idx_enterprise_financial_report_item_report_id`：财报明细按财报主键查询。
- `idx_region_rank_region_year` / `idx_region_rank_region_subject_year`：区域排名按区域年份/科目检索。

## 备注

- 企业域采用软删除：主表通过 `status/deleted_at/deleted_by` 标记删除。
- 业务查询通常只看 `deleted_at IS NULL` 的企业。
- 子表大多 `ON DELETE CASCADE`，主企业物理删除时会级联清理；`enterprise_financial_report_item.subject_id` 为 `RESTRICT`，防止误删科目导致明细失真。
