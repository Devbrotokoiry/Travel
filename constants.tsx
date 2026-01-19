
import React from 'react';
import { TransportMode, Category } from './types';

export const TRANSPORT_STYLES: Record<TransportMode, { color: string; icon: string; dashArray?: string }> = {
  [TransportMode.TRAIN]: { color: '#64748b', icon: '🚂' }, 
  [TransportMode.BUS]: { color: '#64748b', icon: '🚌' },   
  [TransportMode.AUTO]: { color: '#10b981', icon: '🛺', dashArray: '5, 5' },  
  [TransportMode.FERRY]: { color: '#64748b', icon: '⛴️' }, 
  [TransportMode.WALK]: { color: '#10b981', icon: '🚶', dashArray: '2, 4' }, 
  [TransportMode.TAXI]: { color: '#10b981', icon: '🚕', dashArray: '5, 5' }   
};

export const CATEGORY_COLORS: Record<Category, string> = {
  [Category.STATION]: 'bg-pink-500',
  [Category.TEMPLE]: 'bg-emerald-500',
  [Category.NATURE]: 'bg-emerald-500',
  [Category.MARKET]: 'bg-emerald-500',
  [Category.STAY]: 'bg-emerald-500',
  [Category.TRANSIT]: 'bg-emerald-500',
  [Category.FOOD]: 'bg-emerald-500',
  [Category.SIGHTSEEING]: 'bg-emerald-500',
  [Category.SHOPPING]: 'bg-emerald-500',
  [Category.CULTURE]: 'bg-emerald-500'
};

export const CATEGORY_ICONS: Record<Category, string> = {
  [Category.STATION]: '📍',
  [Category.TEMPLE]: '🛕',
  [Category.NATURE]: '🌳',
  [Category.MARKET]: '🛍️',
  [Category.STAY]: '🏨',
  [Category.TRANSIT]: '🔄',
  [Category.FOOD]: '🍜',
  [Category.SIGHTSEEING]: '📸',
  [Category.SHOPPING]: '💸',
  [Category.CULTURE]: '🎭'
};

export const INITIAL_TRIP = {
  id: 'trip-1',
  name: 'Nomad Expedition',
  checkpoints: [],
  segments: [],
  totalBudget: 0
};
