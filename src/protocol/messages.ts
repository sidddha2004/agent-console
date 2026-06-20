export interface BaseMessage {
  type: string;
  seq: number;
}
export interface TokenMessage extends BaseMessage {
  type: "TOKEN";
  text: string;
  stream_id: string;
}
export interface StreamEndMessage extends BaseMessage {
  type: "STREAM_END";
  stream_id: string;
}
export interface ContextSnapshotMessage extends BaseMessage {
  type: "CONTEXT_SNAPSHOT";
  context_id: string;
  data: Record<string, unknown>;
}


export interface ToolCallMessage extends BaseMessage {
  type: "TOOL_CALL";
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  stream_id: string;
}

export interface ToolResultMessage extends BaseMessage {
  type: "TOOL_RESULT";
  call_id: string;
  result: Record<string, unknown>;
  stream_id: string;
}

export interface PingMessage extends BaseMessage {
  type: "PING";
  challenge: string;
}

export interface ErrorMessage extends BaseMessage {
  type: "ERROR";
  code: string;
  message: string;
}
export type ServerMessage =
  | TokenMessage
  | StreamEndMessage
  | ContextSnapshotMessage
  | ToolCallMessage
  | ToolResultMessage
  | PingMessage
  | ErrorMessage;


