
import React from 'react';
import { Trip, Checkpoint, RouteSegment } from '../types';
import { TRANSPORT_STYLES } from '../constants';
import L from 'leaflet';

interface TimelineProps {
  trip: Trip;
  onEditCheckpoint: (checkpoint: Checkpoint) => void;
  onEditSegment: (segment: RouteSegment) => void;
  onDeleteCheckpoint: (id: string) => void;
  onDeleteDestination: (cityName: string) => void;
  onAddActivityToCity: (city: string) => void;
  onMoveCheckpoint: (id: string, delta: number) => void;
  onMoveDestination: (city: string, delta: number) => void;
  userPos: L.LatLng | null;
}

const formatDate = (startDateStr: string, dayNum: number) => {
    const d = new Date(startDateStr);
    d.setDate(d.getDate() + (dayNum - 1));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const Timeline: React.FC<TimelineProps> = ({ 
  trip, 
  onEditCheckpoint, 
  onEditSegment,
  onDeleteCheckpoint,
  onDeleteDestination,
  onAddActivityToCity,
  onMoveCheckpoint,
  onMoveDestination,
  userPos
}) => {
  if (trip.checkpoints.length === 0) {
    return (
      <div className="p-16 text-center">
        <div className="text-4xl opacity-10 mb-6 text-slate-800">🗓️</div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] leading-relaxed">
          Plot nodes on the map<br/>to begin your journey.
        </p>
      </div>
    );
  }

  // Helper to determine if a checkpoint is covered
  const isCovered = (cp: Checkpoint) => {
    // Distance check
    if (userPos) {
        const dist = userPos.distanceTo(L.latLng(cp.lat, cp.lng));
        if (dist < 500) return true;
    }
    // Time check
    if (trip.startDate) {
        const now = new Date();
        const cpDate = new Date(trip.startDate);
        cpDate.setDate(cpDate.getDate() + (cp.day - 1));
        const [h, m] = (cp.endTime || "23:59").split(':').map(Number);
        cpDate.setHours(h, m, 0, 0);
        if (now > cpDate) return true;
    }
    return false;
  };

  // Group by City (Destination) in order of appearance
  const cities: string[] = [];
  const cityGroups: Record<string, Checkpoint[]> = {};
  
  trip.checkpoints.forEach(cp => {
    if (!cityGroups[cp.city]) {
      cities.push(cp.city);
      cityGroups[cp.city] = [];
    }
    cityGroups[cp.city].push(cp);
  });

  return (
    <div className="p-6 relative space-y-12">
      {cities.map((cityName, cityIdx) => {
        const cityCheckpoints = cityGroups[cityName];
        const isStart = cityIdx === 0;
        const isEnd = cityIdx === cities.length - 1;
        
        // Calculate city summary
        const cityTotalCost = cityCheckpoints.reduce((sum, cp) => {
          const transit = trip.segments.find(seg => seg.fromId === cp.id);
          return sum + (Number(cp.cost) || 0) + (Number(transit?.cost) || 0);
        }, 0);
        
        const daysInCity = Array.from(new Set(cityCheckpoints.map(cp => cp.day))).sort((a, b) => a - b);

        return (
          <div key={`city-${cityName}`} className="relative">
            {/* City Header */}
            <div className="bg-white rounded-3xl p-5 shadow-md border border-slate-200 mb-6 group/city sticky top-0 z-30">
              <div className="flex justify-between items-start mb-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {isStart && <span className="bg-pink-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded tracking-widest uppercase">Start</span>}
                    {isEnd && <span className="bg-slate-800 text-white text-[7px] font-black px-1.5 py-0.5 rounded tracking-widest uppercase">End</span>}
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Destination</span>
                  </div>
                  <h3 className="text-lg font-black text-slate-800 uppercase italic tracking-tighter leading-none">{cityName}</h3>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover/city:opacity-100 transition-opacity">
                  <button 
                    onClick={() => onMoveDestination(cityName, -1)}
                    disabled={isStart}
                    className="p-1.5 text-slate-400 hover:text-indigo-500 disabled:opacity-10"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button 
                    onClick={() => onMoveDestination(cityName, 1)}
                    disabled={isEnd}
                    className="p-1.5 text-slate-400 hover:text-indigo-500 disabled:opacity-10"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  <button 
                    onClick={() => onDeleteDestination(cityName)}
                    className="p-1.5 text-slate-300 hover:text-rose-500"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                <div className="flex gap-4">
                  <div className="text-left">
                    <p className="text-[7px] font-bold text-slate-400 uppercase">City Total</p>
                    <p className="text-xs font-black text-slate-700">₹{cityTotalCost.toLocaleString()}</p>
                  </div>
                  <div className="text-left">
                    <p className="text-[7px] font-bold text-slate-400 uppercase">Duration</p>
                    <p className="text-xs font-black text-slate-700">{daysInCity.length} Days</p>
                  </div>
                </div>
                <button 
                  onClick={() => onAddActivityToCity(cityName)}
                  className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 4v16m8-8H4" /></svg>
                  Add Activity
                </button>
              </div>
            </div>

            <div className="ml-8 space-y-8 relative">
              {daysInCity.map((dayNum) => {
                const dayCheckpoints = cityCheckpoints.filter(cp => cp.day === dayNum);
                const dayTotal = dayCheckpoints.reduce((s, cp) => {
                  const transit = trip.segments.find(seg => seg.fromId === cp.id);
                  return s + (Number(cp.cost) || 0) + (Number(transit?.cost) || 0);
                }, 0);

                return (
                  <div key={`${cityName}-day-${dayNum}`} className="relative">
                    <div className="flex items-center gap-3 mb-4 -ml-4">
                      <div className="flex flex-col items-center">
                          <div className="bg-slate-800 text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-sm">
                            Day {dayNum}
                          </div>
                          {trip.startDate && (
                              <span className="text-[7px] font-black text-indigo-500 uppercase mt-1 tracking-tighter">
                                {formatDate(trip.startDate, dayNum)}
                              </span>
                          )}
                      </div>
                      <div className="h-px flex-1 bg-slate-200"></div>
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-lg">
                        Spend: <span className="text-slate-700">₹{dayTotal.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="relative border-l-2 border-slate-200 space-y-4 pb-2">
                      {dayCheckpoints.map((cp, cpIdx) => {
                        const globalIdx = trip.checkpoints.findIndex(c => c.id === cp.id);
                        const nextCp = trip.checkpoints[globalIdx + 1];
                        const transitToNext = nextCp ? trip.segments.find(s => s.fromId === cp.id && s.toId === nextCp.id) : null;
                        const isInterCityTransit = transitToNext && nextCp.city !== cp.city;
                        const cpCovered = isCovered(cp);

                        return (
                          <div key={cp.id} className={`relative pl-8 transition-opacity duration-500 ${cpCovered ? 'opacity-70' : 'opacity-100'}`}>
                            <div className={`absolute left-[-6px] top-4 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm z-10 ${cpCovered ? 'bg-indigo-500' : 'bg-emerald-500'}`}>
                                {cpCovered && (
                                    <div className="absolute inset-0 bg-indigo-500 rounded-full animate-ping opacity-30"></div>
                                )}
                            </div>

                            <div 
                              className={`flex flex-col bg-white rounded-2xl p-4 border shadow-sm transition-all cursor-pointer group ${cpCovered ? 'border-indigo-100 bg-indigo-50/10' : 'border-slate-200 hover:border-pink-300'}`}
                              onClick={() => onEditCheckpoint(cp)}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 overflow-hidden">
                                  <span className={`text-[9px] font-black tracking-tighter shrink-0 uppercase ${cpCovered ? 'text-indigo-500' : 'text-pink-500'}`}>
                                    {cp.startTime ? `${cp.startTime} - ${cp.endTime}` : 'All Day'}
                                    {cpCovered && " • VISITED"}
                                  </span>
                                  <h4 className="text-xs font-black text-slate-800 uppercase truncate italic leading-tight">{cp.name}</h4>
                                </div>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); onMoveCheckpoint(cp.id, -1); }}
                                    disabled={globalIdx === 0}
                                    className="p-1 text-slate-400 hover:text-pink-500 disabled:opacity-10"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 15l7-7 7 7" /></svg>
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); onMoveCheckpoint(cp.id, 1); }}
                                    disabled={globalIdx === trip.checkpoints.length - 1}
                                    className="p-1 text-slate-400 hover:text-pink-500 disabled:opacity-10"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M19 9l-7 7-7-7" /></svg>
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); onDeleteCheckpoint(cp.id); }}
                                    className="p-1 text-slate-300 hover:text-rose-500"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </div>
                              </div>
                              
                              <div className="flex items-center justify-between">
                                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{cp.type}</span>
                                <div className="flex gap-2">
                                   <span className="text-[9px] font-black text-slate-800">₹{(Number(cp.cost) || 0).toLocaleString()}</span>
                                   <span className="text-[9px] font-bold text-slate-400">{cp.timeSpentHours}h</span>
                                </div>
                              </div>
                            </div>

                            {transitToNext && (
                              <div 
                                className={`absolute left-[-15px] ${isInterCityTransit ? 'bottom-[-55px]' : 'bottom-[-22px]'} z-20 group/trans cursor-pointer`}
                                onClick={(e) => { e.stopPropagation(); onEditSegment(transitToNext); }}
                              >
                                 <div className={`bg-white border-2 border-slate-200 rounded-full ${isInterCityTransit ? 'w-8 h-8' : 'w-6 h-6'} flex items-center justify-center text-[10px] shadow-sm hover:border-pink-400 transition-all ${cpCovered ? 'grayscale opacity-50' : ''}`}>
                                   {TRANSPORT_STYLES[transitToNext.mode].icon}
                                 </div>
                                 <div className="absolute left-10 top-2 whitespace-nowrap bg-slate-800 text-white text-[7px] font-black px-2 py-1 rounded uppercase tracking-[0.2em] shadow-lg">
                                   {isInterCityTransit ? `Leaving ${cp.city} • ` : ''}₹{(Number(transitToNext.cost) || 0).toLocaleString()}
                                 </div>
                              </div>
                            )}
                            {isInterCityTransit && <div className="h-16" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
