export interface WaypointTag {
  id: string;
  label: string;
  icon: string;
  description?: string;
  color?: string;
}

// Standard waypoint tags with their associated icons
export const STANDARD_WAYPOINT_TAGS: WaypointTag[] = [
  {
    id: "full-aid",
    label: "Full aid",
    icon: "lucide:utensils",
    description: "Full aid station with food and supplies",
    color: "#10b981",
  },
  {
    id: "water",
    label: "Water",
    icon: "lucide:droplets",
    description: "Water station or water source",
    color: "#3b82f6",
  },
  {
    id: "crew",
    label: "Crew",
    icon: "lucide:users",
    description: "Crew access point",
    color: "#8b5cf6",
  },
  {
    id: "drop-bag",
    label: "Drop bag",
    icon: "lucide:backpack",
    description: "Drop bag pickup location",
    color: "#f59e0b",
  },
  {
    id: "pacer",
    label: "Pacer",
    icon: "lucide:user-check",
    description: "Pacer pickup/dropoff point",
    color: "#ef4444",
  },
  {
    id: "sleep",
    label: "Sleep",
    icon: "lucide:bed-single",
    description: "Rest/sleep station",
    color: "#6366f1",
  },
  {
    id: "timing-mat",
    label: "Timing mat",
    icon: "lucide:timer",
    description: "Timing checkpoint",
    color: "#ec4899",
  },
  {
    id: "toilet",
    label: "Toilet",
    icon: "lucide:toilet",
    description: "Restroom facilities",
    color: "#64748b",
  },
  {
    id: "water-crossing",
    label: "Water crossing",
    icon: "lucide:sailboat",
    description: "Stream, river, or water crossing",
    color: "#06b6d4",
  },
  {
    id: "spectator-viewing",
    label: "Spectator viewing",
    icon: "lucide:eye",
    description: "Spectator viewing area",
    color: "#8b5cf6",
  },
];

// Helper function to get tag by ID
export function getTagById(tagId: string): WaypointTag | undefined {
  return STANDARD_WAYPOINT_TAGS.find((tag) => tag.id === tagId);
}

// Helper function to get tags by IDs
export function getTagsByIds(tagIds: string[]): WaypointTag[] {
  return tagIds.map((id) => getTagById(id)).filter(Boolean) as WaypointTag[];
}

// Helper function to get the primary icon for a waypoint (first tag's icon)
export function getPrimaryIcon(tags: string[]): string {
  if (tags.length === 0) return "lucide:map-pin"; // Default pin icon
  const firstTagId = tags[0];
  if (!firstTagId) return "lucide:map-pin";
  const firstTag = getTagById(firstTagId);
  return firstTag?.icon || "lucide:map-pin";
}

// Helper function to validate if a tag ID is valid
export function isValidTagId(tagId: string): boolean {
  return STANDARD_WAYPOINT_TAGS.some((tag) => tag.id === tagId);
}

// Helper function to validate an array of tag IDs
export function validateTagIds(tagIds: string[]): boolean {
  return tagIds.every((tagId) => isValidTagId(tagId));
}
