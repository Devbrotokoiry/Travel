
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents, Circle } from 'react-leaflet';
import L from 'leaflet';
import { Trip, Checkpoint, RouteSegment, Category, TransportMode, User } from './types';
import { INITIAL_TRIP, TRANSPORT_STYLES } from './constants';
import { Timeline } from './components/Timeline';

// --- Database Engine (IndexedDB Service) ---
const DB_NAME = 'NomadRailDB';
const DB_VERSION = 1;
const STORE_NAME = 'user_trips';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveTripsToDB = async (userId: string, trips: Trip[]) => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.put({ userId, trips, lastSync: new Date().toISOString() });
};

const getTripsFromDB = async (userId: string): Promise<Trip[] | null> => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve) => {
    const request = store.get(userId);
    request.onsuccess = () => resolve(request.result?.trips || null);
    request.onerror = () => resolve(null);
  });
};

// --- Helpers ---
const generateId = () => Math.random().toString(36).substr(2, 9);

const fetchPlaceDetails = async (lat: number, lng: number) => {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`);
    const data = await res.json();
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.village || addr.suburb || addr.city_district || addr.state_district || 'India';
    return {
      name: data.display_name.split(',')[0] || 'Point of Interest',
      city
    };
  } catch {
    return { name: 'Point of Interest', city: 'India' };
  }
};

const syncSegments = (checkpoints: Checkpoint[], existingSegments: RouteSegment[]): RouteSegment[] => {
  const newSegments: RouteSegment[] = [];
  for (let i = 0; i < checkpoints.length - 1; i++) {
    const from = checkpoints[i];
    const to = checkpoints[i + 1];
    const existing = existingSegments.find(s => s.fromId === from.id && s.toId === to.id);
    if (existing) {
      newSegments.push(existing);
    } else {
      const dist = L.latLng(from.lat, from.lng).distanceTo(L.latLng(to.lat, to.lng)) / 1000;
      newSegments.push({
        fromId: from.id,
        toId: to.id,
        mode: from.city === to.city ? TransportMode.AUTO : TransportMode.TRAIN,
        distanceKm: Math.round(dist),
        durationHours: Math.max(0.5, Math.round((dist / 30) * 10) / 10),
        cost: 0,
        safetyNote: ''
      });
    }
  }
  return newSegments;
};

const timeToMinutes = (timeStr: string) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = (totalMinutes: number) => {
  const mins = Math.floor(totalMinutes % (24 * 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const calculateDuration = (start: string, end: string) => {
  if (!start || !end) return 0;
  let startMins = timeToMinutes(start);
  let endMins = timeToMinutes(end);
  if (endMins < startMins) endMins += 1440; // Handle midnight wrap
  return Math.round(((endMins - startMins) / 60) * 10) / 10;
};

// --- Custom Components ---

const MapController: React.FC<{ checkpoints: Checkpoint[], userPos: L.LatLng | null }> = ({ checkpoints, userPos }) => {
  const map = useMap();
  const lastCpIds = useRef<string>('');
  const centeredOnce = useRef(false);

  useEffect(() => {
    const currentIds = checkpoints.map(c => c.id).join(',');
    if (checkpoints.length > 0 && currentIds !== lastCpIds.current) {
      const validCps = checkpoints.filter(c => !isNaN(c.lat) && !isNaN(c.lng));
      if (validCps.length > 0) {
        const bounds = L.latLngBounds(validCps.map(c => [c.lat, c.lng]));
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 14 });
      }
      lastCpIds.current = currentIds;
    }
  }, [checkpoints, map]);

  useEffect(() => {
    if (userPos && !centeredOnce.current && checkpoints.length === 0) {
      map.setView(userPos, 12);
      centeredOnce.current = true;
    }
  }, [userPos, map, checkpoints]);

  return null;
};

const MapEvents: React.FC<{ onLongPress: (latlng: L.LatLng) => void }> = ({ onLongPress }) => {
  useMapEvents({
    contextmenu: (e) => {
      L.DomEvent.stopPropagation(e as any);
      onLongPress(e.latlng);
    }
  });
  return null;
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('nomadrail_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState<string>('');
  const [userPos, setUserPos] = useState<L.LatLng | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const trip = useMemo(() => trips.find(t => t.id === activeTripId) || trips[0], [trips, activeTripId]);

  const [past, setPast] = useState<Trip[][]>([]);
  const [future, setFuture] = useState<Trip[][]>([]);

  const [activeEditor, setActiveEditor] = useState<{ type: 'PIN' | 'SEGMENT'; id: string | { from: string, to: string } } | null>(null);
  const [pendingAdd, setPendingAdd] = useState<{ lat: number, lng: number, name: string, city: string } | null>(null);
  const [customHubName, setCustomHubName] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localForm, setLocalForm] = useState<any>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  // Sync Data on Login
  useEffect(() => {
    if (user) {
      getTripsFromDB(user.id).then(dbTrips => {
        if (dbTrips && dbTrips.length > 0) {
          setTrips(dbTrips);
          setActiveTripId(dbTrips[0].id);
        } else {
          const initial = [{ ...INITIAL_TRIP, id: generateId(), name: 'My First Trip' }];
          setTrips(initial);
          setActiveTripId(initial[0].id);
        }
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [user]);

  // Persistence to Database
  useEffect(() => {
    if (user && trips.length > 0) {
      saveTripsToDB(user.id, trips);
    }
  }, [trips, user]);

  // Geolocation Tracking
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserPos(L.latLng(pos.coords.latitude, pos.coords.longitude)),
      (err) => console.error("Location error:", err),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // History Actions
  const recordAction = useCallback((currentTrips: Trip[]) => {
    setPast(prev => [...prev.slice(-24), currentTrips]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setFuture(prev => [trips, ...prev]);
    setPast(past.slice(0, past.length - 1));
    setTrips(previous);
  }, [past, trips]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setPast(prev => [...prev, trips]);
    setFuture(future.slice(1));
    setTrips(next);
  }, [future, trips]);

  // Auth Handlers
  const handleGoogleLogin = () => {
    // Simulated Google Login Popup
    const mockUser: User = {
      id: 'google-user-123',
      name: 'Tanmay Sharma',
      email: 'tanmay.expeditions@gmail.com',
      avatar: 'https://i.pravatar.cc/150?u=tanmay'
    };
    localStorage.setItem('nomadrail_user', JSON.stringify(mockUser));
    setUser(mockUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('nomadrail_user');
    setUser(null);
    setTrips([]);
  };

  // Trip Management
  const createNewTrip = () => {
    recordAction(trips);
    const newId = generateId();
    const newTrip = { ...INITIAL_TRIP, id: newId, name: `Adventure #${trips.length + 1}` };
    setTrips([...trips, newTrip]);
    setActiveTripId(newId);
  };

  const deleteTrip = (id: string) => {
    if (trips.length === 1) return; 
    recordAction(trips);
    const newTrips = trips.filter(t => t.id !== id);
    setTrips(newTrips);
    if (activeTripId === id) setActiveTripId(newTrips[0].id);
  };

  const renameActiveTrip = (newName: string) => {
    recordAction(trips);
    setTrips(trips.map(t => t.id === activeTripId ? { ...t, name: newName } : t));
    setIsRenaming(false);
  };

  const updateActiveTrip = (updater: (prev: Trip) => Trip) => {
    recordAction(trips);
    setTrips(prev => prev.map(t => t.id === activeTripId ? updater(t) : t));
  };

  const addCheckpoint = useCallback(async (lat: number, lng: number, name: string, city: string, targetCity?: string) => {
    const lastCpInTrip = trip.checkpoints[trip.checkpoints.length - 1];
    const lastDay = lastCpInTrip ? lastCpInTrip.day : 1;
    const newCp: Checkpoint = {
      id: generateId(), name, lat, lng, type: Category.SIGHTSEEING,
      timeSpentHours: 2, startTime: "09:00", endTime: "11:00", day: lastDay,
      cost: 0, notes: '', city: targetCity || city
    };
    updateActiveTrip(prev => {
      let newCheckpoints = [...prev.checkpoints, newCp];
      const cityOrder = Array.from(new Set(newCheckpoints.map(c => c.city)));
      const reordered = cityOrder.flatMap(cName => {
        const inCity = newCheckpoints.filter(cp => cp.city === cName);
        return inCity.sort((a, b) => {
          if (a.day !== b.day) return a.day - b.day;
          return (a.startTime || "").localeCompare(b.startTime || "");
        });
      });
      return { ...prev, checkpoints: reordered, segments: syncSegments(reordered, prev.segments) };
    });
    setPendingAdd(null);
    setCustomHubName('');
    openPinEditor(newCp);
  }, [trip, trips]);

  const handleAddActivityToCity = (cityName: string) => {
    const cityCheckpoints = trip.checkpoints.filter(c => c.city === cityName);
    const lastInCity = cityCheckpoints[cityCheckpoints.length - 1];
    addCheckpoint(
      (lastInCity?.lat || 20.5) + (Math.random() - 0.5) * 0.0025, 
      (lastInCity?.lng || 78.9) + (Math.random() - 0.5) * 0.0025, 
      `New Activity`, cityName, cityName
    );
  };

  const moveCheckpoint = (id: string, delta: number) => {
    updateActiveTrip(prev => {
      const idx = prev.checkpoints.findIndex(c => c.id === id);
      const newIdx = idx + delta;
      if (idx === -1 || newIdx < 0 || newIdx >= prev.checkpoints.length) return prev;
      const newCps = [...prev.checkpoints];
      [newCps[idx], newCps[newIdx]] = [newCps[newIdx], newCps[idx]];
      return { ...prev, checkpoints: newCps, segments: syncSegments(newCps, prev.segments) };
    });
  };

  const moveDestination = (cityName: string, delta: number) => {
    updateActiveTrip(prev => {
      const cities = Array.from(new Set(prev.checkpoints.map(c => c.city)));
      const cityIdx = cities.indexOf(cityName);
      const targetIdx = cityIdx + delta;
      if (targetIdx < 0 || targetIdx >= cities.length) return prev;
      const newCityOrder = [...cities];
      [newCityOrder[cityIdx], newCityOrder[targetIdx]] = [newCityOrder[targetIdx], newCityOrder[cityIdx]];
      const reorderedCps = newCityOrder.flatMap(c => prev.checkpoints.filter(cp => cp.city === c));
      return { ...prev, checkpoints: reorderedCps, segments: syncSegments(reorderedCps, prev.segments) };
    });
  };

  // Search logic
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (searchQuery.length < 2) { setSuggestions([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(searchQuery)}&addressdetails=1&limit=12&dedupe=1&accept-language=en`);
        const data = await res.json();
        setSuggestions(data || []);
      } finally { setIsSearching(false); }
    }, 450);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  const handleSelectSuggestion = async (item: any) => {
    const addr = item.address || {};
    const city = addr.city || addr.town || addr.village || addr.suburb || addr.city_district || addr.state_district || 'India';
    setPendingAdd({ lat: parseFloat(item.lat), lng: parseFloat(item.lon), name: item.display_name.split(',')[0], city: city });
    setSearchQuery('');
    setSuggestions([]);
  };

  const handleMapLongPress = async (ll: L.LatLng) => {
      const details = await fetchPlaceDetails(ll.lat, ll.lng);
      setPendingAdd({ lat: ll.lat, lng: ll.lng, name: details.name, city: details.city });
  };

  const openPinEditor = (cp: Checkpoint) => { setLocalForm({ ...cp }); setActiveEditor({ type: 'PIN', id: cp.id }); };
  const openSegmentEditor = (seg: RouteSegment) => { setLocalForm({ ...seg }); setActiveEditor({ type: 'SEGMENT', id: { from: seg.fromId, to: seg.toId } }); };

  const handleSave = () => {
    if (!activeEditor || !localForm) return;
    updateActiveTrip(prev => {
      if (activeEditor.type === 'PIN') {
        const sanitizedForm = { ...localForm, day: parseInt(localForm.day) || 1, cost: parseInt(localForm.cost) || 0, timeSpentHours: parseFloat(localForm.timeSpentHours) || 0 };
        const newCps = prev.checkpoints.map(c => c.id === activeEditor.id ? { ...sanitizedForm } : c);
        const cityOrder = Array.from(new Set(newCps.map(c => c.city)));
        const finalCps = cityOrder.flatMap(city => {
            const inCity = newCps.filter(c => c.city === city);
            return inCity.sort((a, b) => {
                if (a.day !== b.day) return a.day - b.day;
                return (a.startTime || "").localeCompare(b.startTime || "");
            });
        });
        return { ...prev, checkpoints: finalCps, segments: syncSegments(finalCps, prev.segments) };
      } else {
        const id = activeEditor.id as { from: string, to: string };
        const durationHours = parseFloat(localForm.durationHours) || 0;
        const fromIdx = prev.checkpoints.findIndex(c => c.id === id.from);
        const toIdx = prev.checkpoints.findIndex(c => c.id === id.to);
        if (fromIdx !== -1 && toIdx !== -1) {
          const fromCp = prev.checkpoints[fromIdx];
          const toCp = prev.checkpoints[toIdx];
          const startMins = timeToMinutes(fromCp.endTime || fromCp.startTime || "09:00");
          const totalMins = startMins + (durationHours * 60);
          const arrivalTime = minutesToTime(totalMins);
          const newArrivalDay = fromCp.day + Math.floor(totalMins / 1440);
          const dayShift = newArrivalDay - toCp.day;
          const shiftedCps = prev.checkpoints.map((cp, idx) => {
            if (idx === toIdx) return { ...cp, day: newArrivalDay, startTime: arrivalTime, endTime: minutesToTime(totalMins + (cp.timeSpentHours * 60)) };
            if (idx > toIdx) return { ...cp, day: cp.day + dayShift };
            return cp;
          });
          return { ...prev, checkpoints: shiftedCps, segments: prev.segments.map(s => (s.fromId === id.from && s.toId === id.to) ? { ...localForm, durationHours } : s) };
        }
        return { ...prev, segments: prev.segments.map(s => (s.fromId === id.from && s.toId === id.to) ? { ...localForm, cost: parseInt(localForm.cost) || 0, durationHours: parseFloat(localForm.durationHours) || 0 } : s) };
      }
    });
    setActiveEditor(null);
  };

  const handleDeleteCheckpoint = (id: string) => {
    updateActiveTrip(prev => {
      const newCheckpoints = prev.checkpoints.filter(c => c.id !== id);
      return { ...prev, checkpoints: newCheckpoints, segments: syncSegments(newCheckpoints, prev.segments) };
    });
    if (activeEditor?.id === id) setActiveEditor(null);
  };

  const handleDeleteDestination = (cityName: string) => {
    updateActiveTrip(prev => {
      const newCheckpoints = prev.checkpoints.filter(c => c.city !== cityName);
      return { ...prev, checkpoints: newCheckpoints, segments: syncSegments(newCheckpoints, prev.segments) };
    });
  };

  const uniqueCities = useMemo(() => Array.from(new Set(trip?.checkpoints.map(c => c.city) || [])), [trip]);

  const recommendedCities = useMemo(() => {
      if (!pendingAdd) return [];
      return uniqueCities.map(cName => {
          const inCity = trip.checkpoints.filter(cp => cp.city === cName);
          const dist = L.latLng(pendingAdd.lat, pendingAdd.lng).distanceTo(L.latLng(inCity[0].lat, inCity[0].lng)) / 1000;
          return { name: cName, distance: dist };
      }).sort((a, b) => a.distance - b.distance);
  }, [pendingAdd, uniqueCities, trip]);

  const updateTripStartDate = (date: string) => updateActiveTrip(prev => ({ ...prev, startDate: date }));

  const grandTotal = useMemo(() => {
    const cpTotal = trip?.checkpoints.reduce((sum, cp) => sum + (Number(cp.cost) || 0), 0) || 0;
    const segTotal = trip?.segments.reduce((sum, seg) => sum + (Number(seg.cost) || 0), 0) || 0;
    return cpTotal + segTotal;
  }, [trip]);

  const tripCoverage = useMemo(() => {
    if (!trip || trip.checkpoints.length === 0) return 0;
    let reachedCount = 0;
    const now = new Date();
    trip.checkpoints.forEach(cp => {
      let covered = false;
      if (userPos && userPos.distanceTo(L.latLng(cp.lat, cp.lng)) < 500) covered = true;
      if (!covered && trip.startDate) {
        const cpDate = new Date(trip.startDate);
        cpDate.setDate(cpDate.getDate() + (cp.day - 1));
        const [h, m] = (cp.endTime || "23:59").split(':').map(Number);
        cpDate.setHours(h, m, 0, 0);
        if (now > cpDate) covered = true;
      }
      if (covered) reachedCount++;
    });
    return Math.round((reachedCount / trip.checkpoints.length) * 100);
  }, [trip, userPos]);

  // Login Screen Component
  if (!user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-900 relative overflow-hidden font-sans">
        <div className="absolute inset-0 opacity-40 bg-[url('https://images.unsplash.com/photo-1474487059220-de05345bd331?auto=format&fit=crop&q=80&w=2000')] bg-cover bg-center"></div>
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-transparent to-slate-900"></div>
        
        <div className="relative glass-morphism rounded-[40px] w-full max-w-lg p-12 text-center shadow-2xl border-white/20 animate-slide-up">
           <div className="w-20 h-20 bg-pink-500 rounded-3xl mx-auto mb-8 flex items-center justify-center text-4xl shadow-xl shadow-pink-500/30">🧭</div>
           <h1 className="text-4xl font-black text-slate-800 tracking-tighter uppercase italic mb-4">Nomad<span className="text-pink-500">Rail</span></h1>
           <p className="text-slate-500 font-bold text-sm mb-12 tracking-wide uppercase">The Ultimate Indian Expedition Planner</p>
           
           <div className="space-y-4">
              <button 
                onClick={handleGoogleLogin}
                className="w-full bg-white hover:bg-slate-50 text-slate-800 py-4 px-8 rounded-2xl flex items-center justify-center gap-4 border border-slate-200 shadow-lg transition-all active:scale-95 group"
              >
                <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" className="w-6 h-6" alt="G" />
                <span className="font-black text-xs uppercase tracking-widest">Sign in with Google</span>
              </button>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-6">Securely sync your expeditions with Nomad Cloud</p>
           </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-200 gap-4">
        <div className="animate-spin h-12 w-12 border-4 border-pink-500 border-t-transparent rounded-full"></div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Syncing Nomad Cloud...</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row relative overflow-hidden font-sans bg-slate-200">
      
      {/* Search Bar */}
      <div className="absolute top-6 left-6 right-6 md:left-[430px] z-[1001] pointer-events-none">
        <div className="relative w-full max-w-lg pointer-events-auto">
          <div className="bg-white rounded-2xl px-5 py-3 shadow-xl flex items-center border border-slate-200 focus-within:border-pink-400 transition-all">
            <span className="text-slate-400 mr-4 text-xl">🧭</span>
            <input 
              type="text" placeholder="Search landmarks, museums, or cities..." 
              className="bg-transparent border-none outline-none flex-1 text-black text-sm font-bold placeholder:text-slate-400"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && <div className="animate-spin h-5 w-5 border-2 border-pink-400 border-t-transparent rounded-full ml-3"></div>}
          </div>
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden animate-slide-down max-h-[350px] overflow-y-auto no-scrollbar">
              {suggestions.map((item, idx) => (
                <button
                  key={`suggestion-${idx}`} onClick={() => handleSelectSuggestion(item)}
                  className="w-full text-left px-5 py-3.5 hover:bg-slate-50 flex items-center gap-4 transition-all border-b border-slate-100 last:border-none"
                >
                  <span className="text-xl text-pink-500">📍</span>
                  <div className="overflow-hidden">
                    <p className="font-bold text-black text-[13px] truncate leading-tight">{item.display_name.split(',')[0]}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase truncate mt-0.5 tracking-tight">{item.display_name.split(',').slice(1, 4).join(',').trim() || 'India'}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 relative z-0 h-full">
        <MapContainer center={[20.5937, 78.9629] as any} zoom={5} className="h-full w-full">
          <TileLayer url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png" />
          <MapController checkpoints={trip?.checkpoints || []} userPos={userPos} />
          <MapEvents onLongPress={handleMapLongPress} />
          {userPos && <Marker position={userPos} icon={L.divIcon({ className: '', html: `<div class="w-6 h-6 bg-blue-500/30 rounded-full flex items-center justify-center"><div class="w-3 h-3 bg-blue-600 rounded-full border-2 border-white shadow-lg animate-pulse"></div></div>`, iconSize: [24, 24], iconAnchor: [12, 12] })} />}
          {trip?.checkpoints.map((cp, idx) => (
            <Marker 
              key={`map-marker-${cp.id}`} position={[cp.lat, cp.lng]}
              icon={L.divIcon({ className: '', html: `<div class="${trip.checkpoints.findIndex(c => c.city === cp.city) === idx ? 'w-5 h-5 bg-pink-500 shadow-lg ring-2 ring-white' : 'w-3.5 h-3.5 bg-emerald-500 shadow-md ring-1 ring-white'} rounded-full transition-all hover:scale-125 flex items-center justify-center text-[8px] font-bold text-white">${cp.day}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] })}
              eventHandlers={{ click: () => openPinEditor(cp) }}
            />
          ))}
          {trip?.segments.map((seg) => {
            const from = trip.checkpoints.find(c => c.id === seg.fromId);
            const to = trip.checkpoints.find(c => c.id === seg.toId);
            if (!from || !to) return null;
            const style = TRANSPORT_STYLES[seg.mode];
            return <Polyline key={`map-polyline-${seg.fromId}-${seg.toId}-${seg.mode}`} positions={[[from.lat, from.lng], [to.lat, to.lng]]} color={style.color} weight={from.city !== to.city ? 6 : 4} opacity={0.8} dashArray={style.dashArray || ''} eventHandlers={{ click: () => openSegmentEditor(seg) }} />;
          })}
        </MapContainer>
        <div className="absolute bottom-6 right-6 z-[1001] flex flex-col gap-3">
          <button onClick={() => { if (userPos) (document.querySelector('.leaflet-container') as any)?._leaflet_map?.flyTo(userPos, 15); }} className="w-12 h-12 bg-white rounded-full shadow-2xl flex items-center justify-center hover:bg-slate-50 transition-all border border-slate-200 group" title="My Location">🎯</button>
        </div>
      </div>

      <div className={`fixed inset-0 md:relative md:w-[420px] bg-slate-200 z-[1002] flex flex-col transition-transform duration-300 border-r border-slate-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* User Profile / Trip Switcher */}
        <div className="bg-slate-800 p-4 border-b border-white/5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <img src={user.avatar} className="w-8 h-8 rounded-full border-2 border-pink-500" alt="Avatar" />
                   <div>
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-[0.2em] leading-none mb-1">Explorer</p>
                      <p className="text-[10px] font-black text-white uppercase italic">{user.name}</p>
                   </div>
                </div>
                <button onClick={handleLogout} className="text-slate-400 hover:text-rose-400 transition-colors p-2">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
            </div>
            <div className="flex items-center justify-between">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">My Saved Expeditions</span>
                <button onClick={createNewTrip} className="bg-pink-500 hover:bg-pink-400 text-white w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-90"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M12 4v16m8-8H4" /></svg></button>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {trips.map(t => (
                    <button key={t.id} onClick={() => setActiveTripId(t.id)} className={`whitespace-nowrap px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border-2 ${activeTripId === t.id ? 'bg-white border-pink-500 text-slate-800 shadow-md' : 'bg-slate-700/50 border-transparent text-slate-300 hover:bg-slate-700'}`}>{t.name}</button>
                ))}
            </div>
        </div>

        <div className="p-8 bg-white border-b border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <div className="flex-1 min-w-0 mr-4">
                {isRenaming ? (
                    <input autoFocus className="w-full bg-slate-50 border-2 border-pink-400 rounded-lg px-2 py-1 text-sm font-black italic outline-none" defaultValue={trip?.name} onBlur={(e) => renameActiveTrip(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && renameActiveTrip((e.target as any).value)} />
                ) : (
                    <h1 onClick={() => setIsRenaming(true)} className="text-xl font-black text-slate-800 tracking-tighter uppercase italic cursor-pointer hover:text-pink-500 transition-colors truncate">{trip?.name || 'Nomad Expedition'}</h1>
                )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={undo} disabled={past.length === 0} className="p-2 text-slate-400 hover:text-pink-500 disabled:opacity-20 transition-all rounded-lg hover:bg-slate-50"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l5 5m-5-5l5-5"/></svg></button>
              <button onClick={redo} disabled={future.length === 0} className="p-2 text-slate-400 hover:text-pink-500 disabled:opacity-20 transition-all rounded-lg hover:bg-slate-50"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 10H11a8 8 0 00-8 8v2m18-10l-5 5m5-5l-5-5"/></svg></button>
              {trips.length > 1 && <button onClick={() => deleteTrip(activeTripId)} className="p-2 text-slate-400 hover:text-rose-500 transition-all rounded-lg hover:bg-slate-50"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>}
              <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-slate-400"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Start Date</label>
                <input type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-[11px] font-bold text-slate-700 outline-none focus:border-pink-500" value={trip?.startDate || ''} onChange={(e) => updateTripStartDate(e.target.value)} />
              </div>
              <div className="flex flex-col justify-end">
                <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-1">Expedition Progress</label>
                <div className="w-full bg-slate-100 rounded-full h-8 flex items-center px-4 relative overflow-hidden group">
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 to-pink-500 transition-all duration-1000 ease-out" style={{ width: `${tripCoverage}%` }}></div>
                  <span className="relative z-10 text-[10px] font-black text-slate-800 drop-shadow-sm">{tripCoverage}% Covered</span>
                </div>
              </div>
          </div>
          <div className="flex justify-between items-end">
            <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Spend</p><h2 className="text-2xl font-black text-slate-800">₹{grandTotal.toLocaleString()}</h2></div>
            <div className="text-right"><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nodes</p><h2 className="text-xl font-black text-pink-500">{trip?.checkpoints.length || 0}</h2></div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar bg-slate-300/10">
          {trip && <Timeline trip={trip} onEditCheckpoint={openPinEditor} onEditSegment={openSegmentEditor} onDeleteCheckpoint={handleDeleteCheckpoint} onDeleteDestination={handleDeleteDestination} onAddActivityToCity={handleAddActivityToCity} onMoveCheckpoint={moveCheckpoint} onMoveDestination={moveDestination} userPos={userPos} />}
        </div>
      </div>

      {pendingAdd && (
          <div className="fixed inset-0 z-[2005] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-sm">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-300 overflow-hidden">
                <div className="p-8 text-center">
                    <div className="w-16 h-16 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">📍</div>
                    <h3 className="text-xl font-black text-slate-800 uppercase italic tracking-tighter mb-2 leading-tight">{pendingAdd.name}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-8">Assign to a Hub</p>
                    <div className="space-y-4">
                        <button onClick={() => addCheckpoint(pendingAdd.lat, pendingAdd.lng, pendingAdd.name, pendingAdd.city)} className="w-full py-4 bg-slate-800 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-between px-6"><span>New Hub: {pendingAdd.city}</span><span className="bg-white/20 px-2 py-0.5 rounded text-[8px]">Auto</span></button>
                        <div className="flex gap-2"><input type="text" placeholder="Custom Hub Name..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[11px] font-bold outline-none focus:border-pink-500" value={customHubName} onChange={(e) => setCustomHubName(e.target.value)} /><button onClick={() => customHubName.trim() && addCheckpoint(pendingAdd.lat, pendingAdd.lng, pendingAdd.name, customHubName.trim())} className="bg-pink-500 text-white px-4 rounded-xl text-[8px] font-black uppercase tracking-widest">Create</button></div>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200"><button onClick={() => setPendingAdd(null)} className="w-full py-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Cancel</button></div>
            </div>
          </div>
      )}

      {activeEditor && localForm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl border border-slate-300 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50"><h3 className="font-bold text-slate-700 tracking-tight text-xs uppercase">{activeEditor.type === 'PIN' ? 'Place Settings' : 'Transit Settings'}</h3><button onClick={() => setActiveEditor(null)} className="text-slate-400 hover:text-slate-600">✕</button></div>
            <div className="p-6 space-y-5">
              {activeEditor.type === 'PIN' ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5 tracking-widest">Day</label><input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm font-black focus:ring-2 focus:ring-pink-500 outline-none" value={localForm.day} onChange={(e) => setLocalForm({ ...localForm, day: e.target.value })} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5 tracking-widest">Name</label><input className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm font-black focus:border-pink-500 outline-none" value={localForm.name} onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5 tracking-widest">Spend (₹)</label><input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm font-black" value={localForm.cost} onChange={(e) => setLocalForm({ ...localForm, cost: e.target.value })} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5 tracking-widest">Stay (h)</label><input type="number" step="0.5" className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm font-black" value={localForm.timeSpentHours} onChange={(e) => setLocalForm({ ...localForm, timeSpentHours: e.target.value })} /></div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                     {Object.values(TransportMode).map(mode => (
                       <button key={mode} onClick={() => setLocalForm({...localForm, mode})} className={`p-2 rounded-lg border-2 font-bold uppercase text-[9px] flex flex-col items-center ${localForm.mode === mode ? 'border-pink-500 bg-pink-50 text-pink-600' : 'border-slate-200 bg-white text-slate-500'}`}><span>{TRANSPORT_STYLES[mode].icon}</span>{mode}</button>
                     ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Fare (₹)</label><input type="number" className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm font-black" value={localForm.cost} onChange={(e) => setLocalForm({ ...localForm, cost: e.target.value })} /></div>
                    <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Dur (h)</label><input type="number" step="0.5" className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm font-black" value={localForm.durationHours} onChange={(e) => setLocalForm({ ...localForm, durationHours: e.target.value })} /></div>
                  </div>
                </>
              )}
            </div>
            <div className="p-6 border-t border-slate-200 bg-slate-50 flex gap-4"><button onClick={() => setActiveEditor(null)} className="flex-1 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cancel</button><button onClick={handleSave} className="flex-1 py-3 bg-slate-800 rounded-xl text-[10px] font-bold text-white uppercase tracking-widest shadow-lg">Update</button></div>
          </div>
        </div>
      )}
      {!isSidebarOpen && <button onClick={() => setIsSidebarOpen(true)} className="md:hidden fixed bottom-10 left-1/2 -translate-x-1/2 z-[1001] bg-slate-800 text-white px-8 py-3 rounded-full shadow-2xl font-bold text-xs uppercase tracking-widest">Expedition Log</button>}
    </div>
  );
}
