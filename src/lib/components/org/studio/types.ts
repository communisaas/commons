export type ReasoningStage = 'ground' | 'author' | 'resolve';

export interface ThoughtEntry {
	kind: 'thought';
	stage: ReasoningStage;
	content: string;
	ts: number;
}

export interface ActionEntry {
	kind: 'action';
	stage: ReasoningStage;
	action: string;
	title: string;
	status: 'in_progress' | 'complete' | 'error';
	statusMessage?: string;
	ts: number;
}

export type ReasoningEntry = ThoughtEntry | ActionEntry;
