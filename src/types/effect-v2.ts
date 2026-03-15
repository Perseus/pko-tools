export interface MagicSingleEntry {
  id: number;
  data_name: string;
  name: string;
  models: string[];
  velocity: number;
  particles: string[];
  dummies: number[];
  render_idx: number;
  lightId: number;
  result_effect: string;
}

export interface MagicSingleTable {
  recordSize: number;
  entries: MagicSingleEntry[];
}
