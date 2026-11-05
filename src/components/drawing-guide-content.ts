export type DrawingGuideKind =
  | "rectangle"
  | "rounded-corners"
  | "semicircular-top"
  | "semielliptical-top"
  | "concave-top"
  | "trapezoid"
  | "beveled-corner"
  | "rounded-slot"
  | "u-notch"
  | "circular-hole"
  | "triangular-notch"
  | "rectangular-notch"
  | "edge-offsets"
  | "centering"
  | "symmetry"
  | "hole-spacing"
  | "equal-spacing";

type GuideEntry = {
  id: DrawingGuideKind;
  title: string;
  description: string;
  example: string;
};

type GuideChapter = { title: string; entries: GuideEntry[] };

export const drawingGuideChapters: GuideChapter[] = [
  {
    title: "Shape and size",
    entries: [
      {
        id: "rectangle",
        title: "Rectangle, width and height",
        description:
          "Width is the overall horizontal size; height is the overall vertical size. State both measurements to define a rectangular outline.",
        example: "Draw a rectangle 140 mm wide and 100 mm high.",
      },
      {
        id: "rounded-corners",
        title: "Rounded corners and radius",
        description:
          "A rounded corner joins two edges with an arc. R denotes its radius. Specify which corners to round and the radius of each.",
        example:
          "Draw an outline 140 mm wide and 180 mm high. Round the top two corners with R35; keep the bottom corners square.",
      },
      {
        id: "circular-hole",
        title: "Circular hole and diameter",
        description:
          "The diameter, written Ø, measures across the circle through its center. Describe the hole size and its center position separately.",
        example: "Add a circular hole with a diameter of 20 mm.",
      },
      {
        id: "triangular-notch",
        title: "Triangular notch",
        description:
          "A triangular notch cuts inward from an edge. Measure the opening along that edge and the depth perpendicular to it. Locate the center of the opening from a named reference edge.",
        example:
          "On the right edge, add a triangular notch with an opening of 2 mm and an inward depth of 3 mm. Its opening center is 70 mm below the top edge.",
      },
      {
        id: "rectangular-notch",
        title: "Rectangular notch",
        description:
          "A rectangular notch removes a rectangular area from an edge. State its opening, inward depth and position; the opening follows the edge even when it is vertical.",
        example:
          "On the right edge, add a rectangular notch with an opening of 10 mm and an inward depth of 15 mm. Its opening center is 35 mm below the top edge.",
      },
    ],
  },
  {
    title: "Position and arrangement",
    entries: [
      {
        id: "edge-offsets",
        title: "Position from an edge",
        description:
          "Name the reference edges and the point being located. For a hole, measure to its center. One horizontal and one vertical distance fix its position.",
        example:
          "Add an 8 mm diameter hole. Its center is 40 mm from the left edge and 30 mm below the top edge.",
      },
      {
        id: "centering",
        title: "Centering",
        description:
          "Horizontally centered means equal distances to the left and right edges; vertically centered means equal distances to the top and bottom edges. Specify either or both directions.",
        example:
          "In a 120 × 80 mm rectangle, add a 10 mm diameter hole centered both horizontally and vertically.",
      },
      {
        id: "symmetry",
        title: "Left-right symmetry",
        description:
          "Matching features mirror each other across the vertical centerline. A pair means two features in total, one on each side. Dashed centerlines are positioning references.",
        example:
          "Place a matching triangular notch on each of the left and right edges, at the same height and mirrored about the vertical centerline.",
      },
      {
        id: "hole-spacing",
        title: "Hole center spacing",
        description:
          "Center spacing is measured between the centers of two holes. Specify whether the holes align horizontally or vertically, and describe their diameters separately.",
        example:
          "Place two 10 mm diameter holes on the same horizontal line, with 50 mm between their centers.",
      },
      {
        id: "equal-spacing",
        title: "Equal spacing",
        description:
          "State the total number, arrangement direction and spacing between adjacent centers. Give the first center position or describe how the whole group is centered to locate the group.",
        example:
          "In a 140 × 70 mm rectangle, place three 8 mm diameter holes in a horizontal row. Space their centers 50 mm apart and center the row in the rectangle.",
      },
    ],
  },
  {
    title: "Common geometric structures",
    entries: [
      {
        id: "beveled-corner",
        title: "Beveled corner",
        description:
          "Replace a corner with a straight diagonal edge. State how far to measure along each of the two original edges, and identify the corner. Equal offsets at a square corner give a 45° bevel.",
        example:
          "Draw a 120 × 80 mm rectangle. At the upper-right corner, measure 10 mm along each adjacent edge and join those points with a straight line.",
      },
      {
        id: "trapezoid",
        title: "Sloping sides and trapezoids",
        description:
          "For a trapezoid with parallel top and bottom edges, specify both widths and the perpendicular height. Say whether the top edge is centered or offset to define the sloping sides.",
        example:
          "Draw a trapezoid with an 80 mm top edge, a 120 mm bottom edge and a height of 100 mm. Center the top edge above the bottom edge so the left and right sides are symmetrical.",
      },
      {
        id: "semicircular-top",
        title: "Semicircular arched top",
        description:
          "The two upper endpoints of the straight sides are joined by an upward semicircle. Span is the horizontal distance between the endpoints; rise is the distance from their connecting line to the arc top. For a semicircle, the rise equals half the span. Overall height includes the straight sides and the rise.",
        example:
          "Draw an outline 10 mm wide, with a horizontal bottom and vertical sides 4 mm high. Join the upper endpoints with an upward semicircular arc spanning 10 mm with a rise of 5 mm. The overall height is 9 mm.",
      },
      {
        id: "semielliptical-top",
        title: "Semi-elliptical arched top",
        description:
          "Join the two upper endpoints with the upper half of an ellipse. Specify its span and rise to define the curve. The horizontal radius is half the span; the vertical radius is the rise. State the straight-side height or the overall height separately.",
        example:
          "Draw an outline 10 mm wide, with a horizontal bottom and vertical sides 4 mm high. Join the upper endpoints with an upward semi-elliptical arc spanning 10 mm with a rise of 3 mm. The overall height is 7 mm.",
      },
      {
        id: "concave-top",
        title: "Inward-curving edge",
        description:
          "An inward curve dips into the outline. State which edge curves, the curve type, its span and its inward depth from the endpoint line. Distinguish this depth from an outward arch's rise.",
        example:
          "Draw an outline 10 mm wide. The upper endpoints are 8 mm above the bottom edge. Join them with a downward, inward-curving half-ellipse spanning 10 mm and dipping 3 mm below the endpoint line.",
      },
      {
        id: "rounded-slot",
        title: "Rounded slot",
        description:
          "A rounded slot has two parallel straight sides joined by semicircular ends. Specify its overall length, width, direction and center position. The end radius is half the width.",
        example:
          "In a 60 × 40 mm rectangle, center a horizontal rounded slot 20 mm long overall and 8 mm wide, with R4 semicircular ends.",
      },
      {
        id: "u-notch",
        title: "Round-bottomed notch (U-shaped)",
        description:
          "A U-shaped notch opens at an edge, with parallel sides and a semicircular inner end. State its opening, total inward depth and location. The depth includes the rounded end; its radius is half the opening.",
        example:
          "Add a U-shaped notch on the right edge. Its opening is 4 mm wide and its total inward depth is 6 mm, including an R2 semicircular inner end.",
      },
    ],
  },
];
