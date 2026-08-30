CREATE TABLE drawings (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    scene JSONB NOT NULL,
    owner_id TEXT,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
