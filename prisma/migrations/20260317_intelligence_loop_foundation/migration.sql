-- Intelligence Loop Foundation
-- Adds 6 new models + relation fields for legislative monitoring, alerts, and scorecards.
-- Also fixes Intelligence.embedding dimension from vector(1024) to vector(768).

-- Fix Intelligence embedding dimension (Gemini embedding-001 outputs 768, not 1024)
ALTER TABLE "intelligence" ALTER COLUMN "embedding" TYPE vector(768);

-- Recreate the hybrid search function with correct vector dimension
CREATE OR REPLACE FUNCTION hybrid_search_intelligence(
  query_text text,
  query_embedding vector(768),
  match_count int DEFAULT 10,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.0,
  rrf_k int DEFAULT 50,
  filter_categories text[] DEFAULT NULL,
  filter_topics text[] DEFAULT NULL,
  filter_min_relevance float DEFAULT NULL,
  filter_published_after timestamptz DEFAULT NULL,
  filter_published_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id text,
  category text,
  title text,
  source text,
  source_url text,
  published_at timestamptz,
  snippet text,
  topics text[],
  entities text[],
  relevance_score float,
  sentiment text,
  geographic_scope text,
  created_at timestamptz,
  expires_at timestamptz,
  score float
)
LANGUAGE sql STABLE
AS $$
WITH full_text AS (
  SELECT
    i.id,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(i.fts, websearch_to_tsquery(query_text)) DESC) AS rank_ix
  FROM intelligence i
  WHERE i.fts @@ websearch_to_tsquery(query_text)
    AND (filter_categories IS NULL OR i.category = ANY(filter_categories))
    AND (filter_topics IS NULL OR i.topics && filter_topics)
    AND (filter_min_relevance IS NULL OR i.relevance_score >= filter_min_relevance)
    AND (filter_published_after IS NULL OR i.published_at >= filter_published_after)
    AND (filter_published_before IS NULL OR i.published_at <= filter_published_before)
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
),
semantic AS (
  SELECT
    i.id,
    ROW_NUMBER() OVER (ORDER BY i.embedding <=> query_embedding) AS rank_ix
  FROM intelligence i
  WHERE i.embedding IS NOT NULL
    AND (filter_categories IS NULL OR i.category = ANY(filter_categories))
    AND (filter_topics IS NULL OR i.topics && filter_topics)
    AND (filter_min_relevance IS NULL OR i.relevance_score >= filter_min_relevance)
    AND (filter_published_after IS NULL OR i.published_at >= filter_published_after)
    AND (filter_published_before IS NULL OR i.published_at <= filter_published_before)
  ORDER BY rank_ix
  LIMIT least(match_count, 30) * 2
)
SELECT
  i.id, i.category, i.title, i.source, i.source_url, i.published_at,
  i.snippet, i.topics, i.entities, i.relevance_score, i.sentiment,
  i.geographic_scope, i.created_at, i.expires_at,
  (
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
    coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
  )::float AS score
FROM full_text
  FULL OUTER JOIN semantic ON full_text.id = semantic.id
  JOIN intelligence i ON coalesce(full_text.id, semantic.id) = i.id
ORDER BY score DESC
LIMIT least(match_count, 30);
$$;

-- Add intelligence loop fields to Campaign
ALTER TABLE "campaign" ADD COLUMN "bill_id" TEXT;
ALTER TABLE "campaign" ADD COLUMN "position" TEXT;

-- Add SES message ID to CampaignDelivery
ALTER TABLE "campaign_delivery" ADD COLUMN "ses_message_id" TEXT;

-- Bill table
CREATE TABLE "bill" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "jurisdiction_level" TEXT NOT NULL,
    "chamber" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'introduced',
    "status_date" TIMESTAMP(3) NOT NULL,
    "sponsors" JSONB,
    "committees" TEXT[],
    "source_url" TEXT NOT NULL,
    "full_text_url" TEXT,
    "topic_embedding" vector(768),
    "topics" TEXT[],
    "entities" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_pkey" PRIMARY KEY ("id")
);

-- OrgBillRelevance table
CREATE TABLE "org_bill_relevance" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "matched_on" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_bill_relevance_pkey" PRIMARY KEY ("id")
);

-- LegislativeAlert table
CREATE TABLE "legislative_alert" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "action_taken" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_at" TIMESTAMP(3),

    CONSTRAINT "legislative_alert_pkey" PRIMARY KEY ("id")
);

-- ReportResponse table
CREATE TABLE "report_response" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'observed',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_response_pkey" PRIMARY KEY ("id")
);

-- LegislativeAction table
CREATE TABLE "legislative_action" (
    "id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "decision_maker_id" TEXT,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "source_url" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legislative_action_pkey" PRIMARY KEY ("id")
);

-- OrgIssueDomain table
CREATE TABLE "org_issue_domain" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "embedding" vector(768),
    "description" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_issue_domain_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "bill_external_id_key" ON "bill"("external_id");
CREATE UNIQUE INDEX "org_bill_relevance_org_id_bill_id_key" ON "org_bill_relevance"("org_id", "bill_id");
CREATE UNIQUE INDEX "org_issue_domain_org_id_label_key" ON "org_issue_domain"("org_id", "label");

-- Standard indexes
CREATE INDEX "bill_jurisdiction_status_idx" ON "bill"("jurisdiction", "status");
CREATE INDEX "bill_status_date_idx" ON "bill"("status_date");
CREATE INDEX "bill_external_id_idx" ON "bill"("external_id");
CREATE INDEX "org_bill_relevance_org_id_score_idx" ON "org_bill_relevance"("org_id", "score");
CREATE INDEX "legislative_alert_org_id_status_idx" ON "legislative_alert"("org_id", "status");
CREATE INDEX "legislative_alert_org_id_created_at_idx" ON "legislative_alert"("org_id", "created_at");
CREATE INDEX "report_response_delivery_id_idx" ON "report_response"("delivery_id");
CREATE INDEX "report_response_occurred_at_idx" ON "report_response"("occurred_at");
CREATE INDEX "legislative_action_bill_id_idx" ON "legislative_action"("bill_id");
CREATE INDEX "legislative_action_decision_maker_id_idx" ON "legislative_action"("decision_maker_id");
CREATE INDEX "legislative_action_occurred_at_idx" ON "legislative_action"("occurred_at");
CREATE INDEX "org_issue_domain_org_id_idx" ON "org_issue_domain"("org_id");

-- Foreign keys
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "org_bill_relevance" ADD CONSTRAINT "org_bill_relevance_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_bill_relevance" ADD CONSTRAINT "org_bill_relevance_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legislative_alert" ADD CONSTRAINT "legislative_alert_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legislative_alert" ADD CONSTRAINT "legislative_alert_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_response" ADD CONSTRAINT "report_response_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "campaign_delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legislative_action" ADD CONSTRAINT "legislative_action_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_issue_domain" ADD CONSTRAINT "org_issue_domain_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW indexes for pgvector cosine similarity (Prisma can't create these for Unsupported types)
CREATE INDEX "bill_topic_embedding_hnsw" ON "bill" USING hnsw ("topic_embedding" vector_cosine_ops);
CREATE INDEX "org_issue_domain_embedding_hnsw" ON "org_issue_domain" USING hnsw ("embedding" vector_cosine_ops);
