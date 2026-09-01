export interface DrawingScene {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface DrawingSummary {
  id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Drawing {
  id: string;
  title: string;
  scene: DrawingScene;
  owner_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDrawingInput {
  title: string;
}

export interface UpdateDrawingInput {
  title: string;
  scene: DrawingScene;
  version: number;
}
