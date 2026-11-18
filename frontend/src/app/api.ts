/**
 * Typed API Client for Ask Your Data backend endpoints.
 */

export interface DatabaseConnection {
  id: string;
  name: string;
  description?: string;
  dialect: string;
  host?: string;
  port?: number;
  database_name?: string;
  username?: string;
  ssl_mode?: string;
  allow_dml: boolean;
  allow_file_uploads: boolean;
  allow_sqllab: boolean;
  row_limit: number;
  statement_timeout_seconds: number;
  cache_timeout_seconds: number;
  is_system: boolean;
  ai_allowed_schemas: string[];
  ai_allowed_tables: string[];
  has_encrypted_password?: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface UploadPreviewColumn {
  name: string;
  type: string;
  original_name: string;
}

export interface UploadPreviewResponse {
  filename: string;
  format: string;
  size_bytes: number;
  suggested_table_name: string;
  columns: UploadPreviewColumn[];
  preview_rows: Record<string, any>[];
  preview_count: number;
}

export interface UploadedFileItem {
  id: string;
  filename: string;
  original_name: string;
  file_format: string;
  file_size_bytes: number;
  table_name: string;
  total_rows?: number;
  total_columns?: number;
  status: string;
  created_at: string;
}

export interface DatasetColumn {
  id: string;
  column_name: string;
  data_type: string;
  verbose_name?: string;
  description?: string;
  is_dimension: boolean;
  is_datetime: boolean;
  is_filterable: boolean;
  is_groupable: boolean;
  is_hidden_from_ai: boolean;
}

export interface DatasetMetric {
  id: string;
  metric_name: string;
  verbose_name?: string;
  metric_type: string;
  sql_expression: string;
  number_format?: string;
  description?: string;
}

// API Connect Interfaces
export interface ApiConnection {
  id: string;
  owner_id?: string;
  name: string;
  base_url: string;
  description?: string;
  auth_type: string;
  auth_config: Record<string, any>;
  default_headers: Record<string, string>;
  timeout_seconds: number;
  max_retries: number;
  verify_ssl: boolean;
  status: string;
  last_tested_at?: string;
  last_test_result?: Record<string, any>;
  endpoint_count: number;
  table_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiConnectionCreatePayload {
  name: string;
  base_url: string;
  description?: string;
  auth_type: string;
  auth_config?: Record<string, any>;
  secret?: string;
  default_headers?: Record<string, string>;
  timeout_seconds?: number;
  max_retries?: number;
  verify_ssl?: boolean;
}

export interface ApiConnectionUpdatePayload {
  name?: string;
  base_url?: string;
  description?: string;
  auth_type?: string;
  auth_config?: Record<string, any>;
  secret?: string;
  default_headers?: Record<string, string>;
  timeout_seconds?: number;
  max_retries?: number;
  verify_ssl?: boolean;
}

export interface ApiConnectionTestRequest {
  base_url: string;
  auth_type?: string;
  auth_config?: Record<string, any>;
  secret?: string;
  headers?: Record<string, string>;
  verify_ssl?: boolean;
}

export interface ApiConnectionTestResponse {
  success: boolean;
  status_code: number;
  message: string;
  duration_ms: number;
  details?: Record<string, any>;
}

export interface ApiExploreRequest {
  connection_id?: string;
  path_or_url: string;
  method?: string;
  headers?: Record<string, string>;
  query_params?: Record<string, any>;
  body?: any;
  pagination_config?: Record<string, any>;
  response_path?: string;
  sample_limit?: number;
}

export interface ApiExploreResponse {
  success: boolean;
  status_code: number;
  duration_ms: number;
  content_type: string;
  error_message?: string;
  raw_json?: any;
  preview_records: Record<string, any>[];
  detected_schema: Record<string, string>;
  total_records_extracted: number;
}

export interface OpenApiImportRequest {
  url?: string;
  spec_content?: string;
}

export interface OpenApiEndpoint {
  name: string;
  path: string;
  method: string;
  summary: string;
  description: string;
  operation_id: string;
  tags: string[];
  query_params: Record<string, any>;
  headers: Record<string, string>;
}

export interface OpenApiImportResponse {
  title: string;
  description: string;
  version: string;
  base_url: string;
  endpoints: OpenApiEndpoint[];
}

export interface ApiDatasetCollection {
  id: string;
  owner_id?: string;
  name: string;
  description?: string;
  tags: string[];
  table_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiDatasetTable {
  id: string;
  collection_id: string;
  connection_id: string;
  endpoint_id?: string;
  semantic_dataset_id?: string;
  dashboard_id?: string;
  dashboard_slug?: string;
  display_name: string;
  table_name: string;
  storage_mode: string;
  record_count: number;
  column_count: number;
  schema_metadata: Record<string, string>;
  last_synced_at?: string;
  materialization_status: string;
  last_error?: string;
  endpoint_path?: string;
  endpoint_method?: string;
  parquet_size_bytes?: number;
  created_at: string;
  updated_at: string;
}

export interface ApiCollectionWithTables extends ApiDatasetCollection {
  tables: ApiDatasetTable[];
}

export interface ApiTableCreatePayload {
  collection_id: string;
  connection_id: string;
  display_name: string;
  table_name: string;
  storage_mode?: string;
  endpoint_id?: string;
  endpoint_spec?: {
    name?: string;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    query_params?: Record<string, any>;
    body?: string;
    pagination_config?: Record<string, any>;
    response_path?: string;
  };
  auto_materialize?: boolean;
  cron_schedule?: string;
}

export interface ApiSyncRun {
  id: string;
  table_id: string;
  job_id?: string;
  status: string;
  records_fetched: number;
  records_written: number;
  execution_duration_ms: number;
  error_message?: string;
  snapshot_path?: string;
  started_at: string;
  completed_at?: string;
}

export interface DatasetItem {
  id: string;
  name: string;
  description?: string;
  database_id: string;
  schema_name?: string;
  table_name?: string;
  is_virtual: boolean;
  sql_query?: string;
  is_active: boolean;
  is_ai_enabled: boolean;
  columns: DatasetColumn[];
  metrics: DatasetMetric[];
  created_at: string;
}

export interface DatasetColumnProfile {
  name: string;
  verbose_name: string;
  data_type: string;
  is_dimension: boolean;
  is_datetime: boolean;
  total_rows: number;
  null_count: number;
  null_percentage: number;
  distinct_count: number;
  min?: number | string | null;
  max?: number | string | null;
  avg?: number | null;
  top_values?: Array<{ value: string; count: number }> | null;
}

export interface DatasetProfileResponse {
  dataset_id: string;
  dataset_name: string;
  table_name?: string;
  total_rows: number;
  columns: DatasetColumnProfile[];
}

export interface DatasetRowsResponse {
  dataset_id: string;
  total: number;
  limit: number;
  offset: number;
  page: number;
  total_pages: number;
  columns: string[];
  column_types: string[];
  rows: any[][];
  duration_ms: number;
}

// --- Table Join Assistant Interfaces ---
export interface ForeignKeyInfo {
  constraint_name: string;
  columns: string[];
  referred_schema: string;
  referred_table: string;
  referred_columns: string[];
}

export interface TableColumnInfo {
  name: string;
  data_type: string;
}

export interface TableKeyInfo {
  schema: string;
  table: string;
  primary_key: string[];
  foreign_keys: ForeignKeyInfo[];
  columns: TableColumnInfo[];
}

export interface DatabaseKeysResponse {
  database_id?: string;
  tables: TableKeyInfo[];
}

export interface JoinSuggestion {
  left_columns: string[];
  right_columns: string[];
  source: "foreign_key" | "name_match";
  confidence: number;
  description?: string;
}

export interface JoinSuggestionsResponse {
  suggestions: JoinSuggestion[];
}

export interface JoinCondition {
  left_col: string;
  right_col: string;
}

export interface JoinColumnSelect {
  table: "t1" | "t2";
  column: string;
  alias?: string;
}

export interface JoinBuildSqlRequest {
  left: string;
  right: string;
  join_type?: string;
  conditions?: JoinCondition[];
  columns?: JoinColumnSelect[];
  select_all?: boolean;
  where?: string;
  limit?: number;
  offset?: number;
  include_limit?: boolean;
}

export interface JoinBuildSqlResponse {
  sql: string;
  dialect: string;
  is_emulated: boolean;
  notes?: string;
}

export interface JoinRunRequest {
  left: string;
  right: string;
  join_type?: string;
  conditions?: JoinCondition[];
  columns?: JoinColumnSelect[];
  select_all?: boolean;
  where?: string;
  limit?: number;
  offset?: number;
  custom_sql?: string;
}

export interface JoinRunResponse {
  columns: string[];
  column_types: string[] | Record<string, string>;
  rows: any[][];
  row_count: number;
  limit: number;
  offset: number;
  is_truncated: boolean;
  execution_duration_ms: number;
  sql: string;
}

export interface ParentRowInfo {
  constraint_name: string;
  parent_table: string;
  fk_columns: string[];
  referred_columns: string[];
  row: Record<string, any> | null;
}

export interface ChildRowsInfo {
  child_table: string;
  fk_columns: string[];
  referred_columns: string[];
  count: number;
  columns: string[];
  rows: any[][];
}

export interface RowsByKeyResponse {
  table: string;
  key_columns: string[];
  key_values: any[];
  row: Record<string, any> | null;
  columns: string[];
  parents: ParentRowInfo[];
  children: ChildRowsInfo[];
}

export interface DatasetFromJoinRequest {
  database_id: string;
  name: string;
  sql: string;
  description?: string;
  left_table?: string;
  right_table?: string;
  join_type?: string;
  create_dashboard?: boolean;
}

export interface DatasetFromJoinResponse {
  dataset_id: string;
  name: string;
  sql_expression: string;
  columns_count: number;
  dashboard_slug?: string;
  dashboard_id?: string;
  message: string;
}

export interface ChartItem {
  id: string;
  title: string;
  description?: string;
  dataset_id: string;
  viz_type: string;
  params: Record<string, any>;
  query_context: Record<string, any>;
  owners: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ChartDataResponse {
  columns: string[];
  column_types: string[];
  rows: any[][];
  row_count: number;
  sql: string;
  duration_ms: number;
}

export interface DashboardPlacement {
  id: string;
  chart_id: string;
  position: { x: number; y: number; w: number; h: number };
  chart?: ChartItem;
}

export interface DashboardFilterItem {
  id: string;
  name: string;
  filter_type: string;
  target_charts: string[];
  default_value: any;
}

export interface DashboardItem {
  id: string;
  title: string;
  description?: string;
  slug: string;
  is_published: boolean;
  layout: Record<string, any>;
  owners: string[];
  charts: DashboardPlacement[];
  filters: DashboardFilterItem[];
  created_at?: string;
  updated_at?: string;
}

export interface AIStatus {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  has_api_key: boolean;
}

export interface GroundingDetail {
  is_grounded: boolean;
  grounding_score: number;
  matched_figures: Array<{ token: string; parsed_value: number }>;
  unmatched_figures: Array<{ token: string; parsed_value: number }>;
  details: string;
}

export interface AIChatResponse {
  conversation_id: string;
  message_id: string;
  result_id?: string;
  answer: string;
  sql?: string | null;
  columns: string[];
  column_types: string[];
  rows: any[][];
  row_count: number;
  duration_ms: number;
  grounding: GroundingDetail;
  recommended_chart: {
    viz_type?: string;
    dimensions?: string[];
    metrics?: string[];
    time_column?: string;
    options?: Record<string, any>;
  };
  steps: Array<{
    step: number;
    tool: string;
    arguments: any;
    output?: any;
    elapsed_ms?: number;
  }>;
  latency_ms: number;
}

export interface AISnapshotItem {
  id: string;
  source_type: "ai_query_result";
  message_id?: string;
  dataset_id?: string;
  dataset_name?: string;
  question: string;
  sql?: string;
  columns: string[];
  column_types: string[];
  rows: any[][];
  row_count: number;
  duration_ms: number;
  recommended_chart: Record<string, any>;
  created_at?: string;
}

export interface SqlQueryResult {
  columns: string[];
  column_types: string[];
  rows: any[][];
  row_count: number;
  duration_ms: number;
  sql: string;
  truncated: boolean;
  cached: boolean;
}

export interface QueryHistoryItem {
  id: string;
  database_id: string;
  sql: string;
  status: string;
  row_count?: number;
  execution_duration_ms?: number;
  error_message?: string;
  triggered_from: string;
  created_at: string;
}

export interface SavedQueryItem {
  id: string;
  database_id: string;
  title: string;
  description?: string;
  sql: string;
  created_at: string;
}

export interface TableInventoryItem {
  name: string;
  type: string;
  row_count_estimate?: number | null;
}

export interface SchemaInventoryItem {
  name: string;
  tables: TableInventoryItem[];
}

export interface DatabaseInventoryResponse {
  database_id?: string;
  database_name?: string;
  schemas: SchemaInventoryItem[];
}

export interface BulkDatasetItem {
  schema_name?: string;
  table_name: string;
}

export interface BulkDatasetCreateRequest {
  database_id: string;
  items: BulkDatasetItem[];
  create_dashboards?: boolean;
}

export interface BulkDatasetItemResult {
  schema?: string;
  table: string;
  schema_name?: string;
  table_name?: string;
  status: "created" | "skipped_existing" | "failed";
  dataset_id?: string | null;
  dashboard_slug?: string | null;
  error?: string | null;
}

export interface BulkDatasetCreateResponse {
  total_requested: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  results: BulkDatasetItemResult[];
}

export interface AutoVisualizeTableItem {
  schema_name?: string;
  table_name: string;
}

export interface AutoVisualizeRequest {
  schemas?: string[];
  tables?: AutoVisualizeTableItem[];
  per_table_dashboards?: boolean;
  unified_dashboard?: boolean;
}

export interface PerTableDashboardSummary {
  schema?: string;
  table: string;
  dashboard_slug?: string | null;
  title?: string | null;
  status: string;
  dataset_id?: string | null;
  error?: string | null;
}

export interface AutoVisualizeResponse {
  database_id: string;
  database_name: string;
  per_table_dashboards_created: number;
  per_table_dashboards: PerTableDashboardSummary[];
  unified_dashboard_slug?: string | null;
  unified_dashboard_title?: string | null;
  sections_count: number;
  charts_count: number;
  columns_visualized: Record<string, string[]>;
  columns_trimmed: Record<string, string[]>;
  summary: string;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const token = localStorage.getItem("ayd_token");
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
    try {
      const errJson = await response.json();
      errorMsg = errJson.message || errJson.detail || errorMsg;
    } catch {
      // fallback
    }
    throw new Error(errorMsg);
  }

  return response.json();
}

export const api = {
  // Databases
  getDatabases: () => request<DatabaseConnection[]>("/api/v1/databases/"),
  createDatabase: (data: any) =>
    request<DatabaseConnection>("/api/v1/databases/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDatabase: (id: string, data: any) =>
    request<DatabaseConnection>(`/api/v1/databases/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteDatabase: (id: string) =>
    request<{ message: string }>(`/api/v1/databases/${id}`, {
      method: "DELETE",
    }),
  testDatabaseLive: (data: any) =>
    request<ConnectionTestResult>("/api/v1/databases/test", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  testDatabaseById: (id: string) =>
    request<ConnectionTestResult>(`/api/v1/databases/${id}/test`, {
      method: "POST",
    }),
  getDatabaseInventory: (id: string) =>
    request<DatabaseInventoryResponse>(`/api/v1/databases/${id}/inventory`, {
      method: "POST",
    }),
  autoVisualizeDatabase: (id: string, data?: AutoVisualizeRequest) =>
    request<AutoVisualizeResponse>(`/api/v1/databases/${id}/auto-visualize`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  getDatabaseSchemas: (id: string) =>
    request<string[]>(`/api/v1/databases/${id}/schemas`),
  getDatabaseTables: (id: string, schema?: string) =>
    request<string[]>(
      `/api/v1/databases/${id}/tables${schema ? `?schema=${encodeURIComponent(schema)}` : ""}`
    ),
  getDatabaseColumns: (id: string, table: string, schema?: string) =>
    request<any[]>(
      `/api/v1/databases/${id}/tables/${encodeURIComponent(table)}/columns${schema ? `?schema=${encodeURIComponent(schema)}` : ""}`
    ),

  // Table Join Assistant
  getDatabaseKeys: (id: string, refresh: boolean = false) =>
    request<DatabaseKeysResponse>(`/api/v1/databases/${id}/keys${refresh ? "?refresh=true" : ""}`),
  getJoinSuggestions: (id: string, left: string, right: string) =>
    request<JoinSuggestionsResponse>(
      `/api/v1/databases/${id}/join-suggestions?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`
    ),
  buildJoinSql: (id: string, data: JoinBuildSqlRequest) =>
    request<JoinBuildSqlResponse>(`/api/v1/databases/${id}/join-builder/sql`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  runJoinQuery: (id: string, data: JoinRunRequest) =>
    request<JoinRunResponse>(`/api/v1/databases/${id}/join-builder/run`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getRowsByKey: (id: string, table: string, keyCol: string, keyValue: string) =>
    request<RowsByKeyResponse>(
      `/api/v1/databases/${id}/rows-by-key?table=${encodeURIComponent(table)}&key_col=${encodeURIComponent(keyCol)}&key_value=${encodeURIComponent(keyValue)}`
    ),
  createDatasetFromJoin: (data: DatasetFromJoinRequest) =>
    request<DatasetFromJoinResponse>("/api/v1/datasets/from-join", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Uploads
  previewUpload: (formData: FormData) =>
    request<UploadPreviewResponse>("/api/v1/uploads/preview", {
      method: "POST",
      body: formData,
    }),
  importUpload: (formData: FormData) =>
    request<{ message: string; dataset_id: string; table_name: string }>("/api/v1/uploads/import", {
      method: "POST",
      body: formData,
    }),
  getUploads: () => request<{ data: UploadedFileItem[] }>("/api/v1/uploads/"),
  deleteUpload: (id: string) =>
    request<{ message: string }>(`/api/v1/uploads/${id}`, {
      method: "DELETE",
    }),

  // Datasets
  getDatasets: () => request<DatasetItem[]>("/api/v1/datasets/"),
  getDataset: (id: string) => request<DatasetItem>(`/api/v1/datasets/${id}`),
  getDatasetProfile: (id: string) => request<DatasetProfileResponse>(`/api/v1/datasets/${id}/profile`),
  getDatasetRows: (id: string, params: { limit?: number; offset?: number; order_by?: string; order_dir?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    if (params.order_by) q.set("order_by", params.order_by);
    if (params.order_dir) q.set("order_dir", params.order_dir);
    const qs = q.toString();
    return request<DatasetRowsResponse>(`/api/v1/datasets/${id}/rows${qs ? `?${qs}` : ""}`);
  },
  createDataset: (data: any) =>
    request<DatasetItem>("/api/v1/datasets/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  bulkCreateDatasets: (data: BulkDatasetCreateRequest) =>
    request<BulkDatasetCreateResponse>("/api/v1/datasets/bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteDataset: (id: string) =>
    request<{ message: string }>(`/api/v1/datasets/${id}`, {
      method: "DELETE",
    }),
  batchDeleteDatasets: (ids: string[]) =>
    request<{ message: string; deleted_count: number }>("/api/v1/datasets/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  addDatasetMetric: (datasetId: string, metric: any) =>
    request<DatasetMetric>(`/api/v1/datasets/${datasetId}/metrics`, {
      method: "POST",
      body: JSON.stringify(metric),
    }),

  // SQL Lab
  executeSql: (data: { database_id: string; sql: string; limit?: number; row_limit?: number }) =>
    request<SqlQueryResult>("/api/v1/sqllab/execute", {
      method: "POST",
      body: JSON.stringify({
        ...data,
        row_limit: data.row_limit || data.limit || 1000,
      }),
    }),
  getSavedQueries: () => request<SavedQueryItem[]>("/api/v1/sqllab/saved-queries"),
  saveQuery: (data: { database_id: string; title: string; sql: string; description?: string }) =>
    request<SavedQueryItem>("/api/v1/sqllab/saved-queries", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteSavedQuery: (id: string) =>
    request<{ message: string }>(`/api/v1/sqllab/saved-queries/${id}`, {
      method: "DELETE",
    }),
  getQueryHistory: () => request<QueryHistoryItem[]>("/api/v1/sqllab/history"),

  // Charts
  getCharts: () => request<ChartItem[]>("/api/v1/charts/"),
  getChart: (id: string) => request<ChartItem>(`/api/v1/charts/${id}`),
  createChart: (data: any) =>
    request<ChartItem>("/api/v1/charts/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateChart: (id: string, data: any) =>
    request<ChartItem>(`/api/v1/charts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteChart: (id: string) =>
    request<{ message: string }>(`/api/v1/charts/${id}`, {
      method: "DELETE",
    }),
  getChartData: (data: any) =>
    request<ChartDataResponse>("/api/v1/charts/data", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Dashboards
  getDashboards: () => request<DashboardItem[]>("/api/v1/dashboards/"),
  getDashboard: (id: string) => request<DashboardItem>(`/api/v1/dashboards/${id}`),
  createDashboard: (data: any) =>
    request<DashboardItem>("/api/v1/dashboards/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDashboard: (id: string, data: any) =>
    request<DashboardItem>(`/api/v1/dashboards/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteDashboard: (id: string) =>
    request<{ message: string }>(`/api/v1/dashboards/${id}`, {
      method: "DELETE",
    }),

  // AI Assistant
  getAIStatus: () => request<AIStatus>("/api/v1/ai/status"),
  askAI: (data: {
    prompt: string;
    conversation_id?: string;
    dataset_id?: string;
    database_id?: string;
    dashboard_id?: string;
  }) =>
    request<AIChatResponse>("/api/v1/ai/chat", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getAIConversations: () => request<Array<{ id: string; title: string; created_at: string }>>("/api/v1/ai/conversations"),
  getAIConversationMessages: (conversationId: string) =>
    request<any[]>(`/api/v1/ai/conversations/${conversationId}/messages`),
  createAISnapshot: (data: {
    message_id?: string;
    dataset_id?: string;
    dataset_name?: string;
    question: string;
    sql?: string;
    columns: string[];
    column_types?: string[];
    rows: any[][];
    row_count: number;
    duration_ms?: number;
    recommended_chart?: any;
  }) =>
    request<AISnapshotItem>("/api/v1/ai/snapshots", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getAISnapshot: (id: string) => request<AISnapshotItem>(`/api/v1/ai/snapshots/${id}`),

  // API Connect
  getApiConnections: () => request<ApiConnection[]>("/api/v1/api-connect/connections"),
  getApiConnection: (id: string) => request<ApiConnection>(`/api/v1/api-connect/connections/${id}`),
  createApiConnection: (data: ApiConnectionCreatePayload) =>
    request<ApiConnection>("/api/v1/api-connect/connections", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateApiConnection: (id: string, data: ApiConnectionUpdatePayload) =>
    request<ApiConnection>(`/api/v1/api-connect/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteApiConnection: (id: string) =>
    request<void>(`/api/v1/api-connect/connections/${id}`, {
      method: "DELETE",
    }),
  testAdhocApiConnection: (data: ApiConnectionTestRequest) =>
    request<ApiConnectionTestResponse>("/api/v1/api-connect/connections/test", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  testSavedApiConnection: (id: string) =>
    request<ApiConnectionTestResponse>(`/api/v1/api-connect/connections/${id}/test`, {
      method: "POST",
    }),
  exploreApiEndpoint: (data: ApiExploreRequest) =>
    request<ApiExploreResponse>("/api/v1/api-connect/explore", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  importOpenApiSpec: (data: OpenApiImportRequest) =>
    request<OpenApiImportResponse>("/api/v1/api-connect/openapi/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getApiCollections: () => request<ApiDatasetCollection[]>("/api/v1/api-connect/collections"),
  getApiCollection: (id: string) => request<ApiCollectionWithTables>(`/api/v1/api-connect/collections/${id}`),
  createApiCollection: (data: { name: string; description?: string; tags?: string[] }) =>
    request<ApiDatasetCollection>("/api/v1/api-connect/collections", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateApiCollection: (id: string, data: { name?: string; description?: string; tags?: string[] }) =>
    request<ApiDatasetCollection>(`/api/v1/api-connect/collections/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteApiCollection: (id: string) =>
    request<void>(`/api/v1/api-connect/collections/${id}`, {
      method: "DELETE",
    }),
  createApiTable: (data: ApiTableCreatePayload) =>
    request<ApiDatasetTable>("/api/v1/api-connect/tables", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteApiTable: (id: string) =>
    request<void>(`/api/v1/api-connect/tables/${id}`, {
      method: "DELETE",
    }),
  refreshApiTable: (id: string) =>
    request<any>(`/api/v1/api-connect/tables/${id}/refresh`, {
      method: "POST",
    }),
  visualizeApiTable: (tableId: string) =>
    request<{
      status: string;
      dashboard_id: string;
      dashboard_slug: string;
      dashboard_title: string;
      dataset_id: string;
      primary_chart_id?: string;
      charts_count: number;
    }>(`/api/v1/api-connect/tables/${tableId}/visualize`, {
      method: "POST",
    }),
  getApiTableSyncRuns: (id: string) =>
    request<ApiSyncRun[]>(`/api/v1/api-connect/tables/${id}/runs`),

  // Super Admin Control Panel API
  getAdminDashboard: () => request<AdminDashboardStats>("/api/v1/admin/dashboard"),
  getAdminUsers: (params?: { search?: string; status?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set("search", params.search);
    if (params?.status && params.status !== "all") searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const qs = searchParams.toString();
    return request<{ total: number; users: AdminUser[] }>(`/api/v1/admin/users${qs ? `?${qs}` : ""}`);
  },
  getAdminUserDetails: (id: string) => request<AdminUser>(`/api/v1/admin/users/${id}`),
  updateUserStatus: (id: string, is_active: boolean) =>
    request<AdminUser>(`/api/v1/admin/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ is_active }),
    }),
  deleteUser: (id: string) =>
    request<{ message: string }>(`/api/v1/admin/users/${id}`, {
      method: "DELETE",
    }),
  getAdminDatasets: () => request<AdminDataset[]>("/api/v1/admin/datasets"),
};

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
  created_at: string;
  last_login?: string | null;
  dataset_count: number;
  chart_count: number;
}

export interface AdminDashboardStats {
  total_users: number;
  active_users: number;
  inactive_users: number;
  total_datasets: number;
  total_charts: number;
  recent_registrations: AdminUser[];
  system_status: Record<string, any>;
}

export interface AdminDataset {
  id: string;
  name: string;
  description?: string;
  database_name: string;
  table_name?: string;
  schema_name?: string;
  is_virtual: boolean;
  owner_email?: string;
  owner_name?: string;
  created_at: string;
  column_count: number;
}
