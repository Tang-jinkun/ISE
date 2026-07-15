import { create } from 'zustand';

interface TimerItem {
  id: string;
  start: number;
  finish: number;
  timer?: any;
  timerInterval?: any;
  counter?: number;
  data?: any;
  rotateCameraId?: number;
  rotateProgress?: number;
  stop?: boolean;
}

export interface TaskSceneState {
  currentInterval: number;
  isTimerRunning: boolean;
  linePosition: number;

  // Data
  calcData: any[];
  currentTaskSceneInfo: {
    content: any[];
    defaultView: {
      zoom: number;
      lon: number;
      lat: number;
      pitch: number;
      bearing: number;
    };
  };

  // Timers lists
  picCurrTimerList: TimerItem[];
  vidVisCurrTimerList: TimerItem[];
  audioCurrTimerList: TimerItem[];
  textCurrTimerList: TimerItem[];
  subtitleCurrTimerList: TimerItem[];
  geoCurrTimerList: TimerItem[];
  rasterCurrTimerList: TimerItem[];
  markerCurrTimerList: TimerItem[];
  mapEaseCurrTimerList: TimerItem[];
  mapRotateTimerList: TimerItem[];
  dynamicCurrTimerList: TimerItem[];
  targetCurrTimerList: TimerItem[];
  flightCurrTimerList: TimerItem[];
  missileCurrTimerList: TimerItem[];

  // Player maps
  videoPlayerMap: Map<string, any>;

  // Camera/Movement states
  alongPauseFlag: boolean;
  alongPhase1: number;
  alongPhase2: number;
  alongPauseParam: any;
  alongCameraId: number | null;
  cameraAlongFrame: ((time: any) => void) | null;

  rotatePauseFlag: boolean;
  rotateCameraId: number;

  subtitleContent: string;
  dynamicPauseFlag: boolean;

  setTaskSceneInfo: (info: any) => void;
}

export const useTaskSceneStore = create<TaskSceneState>((set) => ({
  currentInterval: 0,
  isTimerRunning: false,
  linePosition: 0,
  calcData: [],
  currentTaskSceneInfo: {
    content: [],
    defaultView: { zoom: 3.5, lon: 110, lat: 30, pitch: 0, bearing: 0 }
  },

  picCurrTimerList: [],
  vidVisCurrTimerList: [],
  audioCurrTimerList: [],
  textCurrTimerList: [],
  subtitleCurrTimerList: [],
  geoCurrTimerList: [],
  rasterCurrTimerList: [],
  markerCurrTimerList: [],
  mapEaseCurrTimerList: [],
  mapRotateTimerList: [],
  dynamicCurrTimerList: [],
  targetCurrTimerList: [],
  flightCurrTimerList: [],
  missileCurrTimerList: [],

  videoPlayerMap: new Map(),

  alongPauseFlag: false,
  alongPhase1: 0,
  alongPhase2: 0,
  alongPauseParam: {},
  alongCameraId: null,
  cameraAlongFrame: null,

  rotatePauseFlag: false,
  rotateCameraId: 0,

  subtitleContent: '',
  dynamicPauseFlag: false,

  setTaskSceneInfo: (info) => set((state) => ({
    currentTaskSceneInfo: {
      ...state.currentTaskSceneInfo,
      ...info
    }
  })),
}));
