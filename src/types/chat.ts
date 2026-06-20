export type ToolStatus = "pending" | "running" | "completed" | "stuck";

export interface ToolSegment {
  kind: "tool";
  callId: string;
  toolName: string;
  status: ToolStatus;
  args?: unknown;
  result?: unknown;
}

export interface TextSegment {
  kind: "text";
  text: string;
}

export type StreamSegment = TextSegment | ToolSegment;

export interface ChatStream {
  streamId: string;
  segments: StreamSegment[];
  completed: boolean;
}
