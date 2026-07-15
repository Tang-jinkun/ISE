import mapboxgl from 'mapbox-gl';

class MapManager {
  private map: mapboxgl.Map | null = null;
  private snapshot: { center: any; zoom: number; bearing: number; pitch: number } = {
    center: null,
    zoom: 0,
    bearing: 0,
    pitch: 0
  };

  setMap(map: mapboxgl.Map) {
    this.map = map;
  }

  getMap() {
    return this.map;
  }

  getSnapshoot() {
    return this.snapshot;
  }
}

class TaskSceneManager {
  mapManager = new MapManager();
}

const taskSceneManager = new TaskSceneManager();
export default taskSceneManager;
