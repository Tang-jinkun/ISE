import type { Track, TrackClip } from '../../Scene/components/Timeline';
import type { PathTrack, TimelineItem } from '../components/SceneModal';

/**
 * Adapter function to convert SceneModal's data structure to Timeline's data structure
 * Maps PathTrack to Track and TimelineItem to TrackClip
 */
export const mapPathTrackToTimelineTrack = (pathTrack: PathTrack): Track => {
  return {
    id: pathTrack.id,
    label: pathTrack.name,
    type: pathTrack.type,
    clips: pathTrack.sceneItems.map(mapTimelineItemToTrackClip)
  };
};

export const mapTimelineItemToTrackClip = (item: TimelineItem): TrackClip => {
  // SceneModal uses milliseconds, Timeline uses seconds for logic
  // but we can adjust the scale to match the existing display
  return {
    id: `${item.title}-${item.start}`,
    label: item.title,
    color: 'bg-primary/20 border-primary/30', // Default style, will be refined in CSS
    start: item.start / 1000,
    width: (item.finish - item.start) / 1000
  };
};
