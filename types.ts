
export enum TransportMode {
  TRAIN = 'TRAIN',
  BUS = 'BUS',
  AUTO = 'AUTO',
  FERRY = 'FERRY',
  WALK = 'WALK',
  TAXI = 'TAXI'
}

export enum Category {
  STATION = 'STATION',
  TEMPLE = 'TEMPLE',
  NATURE = 'NATURE',
  MARKET = 'MARKET',
  STAY = 'STAY',
  TRANSIT = 'TRANSIT',
  FOOD = 'FOOD',
  SIGHTSEEING = 'SIGHTSEEING',
  SHOPPING = 'SHOPPING',
  CULTURE = 'CULTURE'
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export interface Checkpoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: Category;
  timeSpentHours: number;
  startTime: string; // HH:MM format
  endTime: string;   // HH:MM format
  day: number;
  cost: number;
  notes: string;
  city: string;
}

export interface RouteSegment {
  fromId: string;
  toId: string;
  mode: TransportMode;
  distanceKm: number;
  durationHours: number;
  cost: number;
  safetyNote: string;
}

export interface Trip {
  id: string;
  name: string;
  checkpoints: Checkpoint[];
  segments: RouteSegment[];
  totalBudget: number;
  startDate?: string; // YYYY-MM-DD
}
