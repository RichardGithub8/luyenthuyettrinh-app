/** Kiểu dữ liệu dùng chung của AI pipeline (thuần, không phụ thuộc Next/Supabase). */
export type Lang = 'vi' | 'en';
export type Goal = 'presentation' | 'reporting' | 'interview' | 'pitching' | 'debating';

export interface Word { word: string; start: number; end: number }
export interface Segment { start: number; end: number; text: string }
export interface Transcript { text: string; durationSec: number; language: string; segments: Segment[]; words: Word[] }

export interface Persona { name: string; role: string; focus: string; questions: string[] }

export class PipelineError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, message?: string) {
    super(message ?? code);
    this.name = 'PipelineError';
  }
}
