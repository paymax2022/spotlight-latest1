// ── Arena Play-Along — mock question bank (dev / offline) ────────────────────
// Used when the backend returns no questions (dev). Each question carries the
// correct option + an explanation so the quiz can give instant gamified feedback
// (points, streaks, reveal). In production the backend serves questions WITHOUT
// the answer and scores server-side.

import type { PlayAlongQuestion } from './types';

export const MOCK_PLAYALONG: Record<string, PlayAlongQuestion[]> = {
  'road-signs': [
    {
      id: 'rs1', prompt: 'A red triangle sign with a person walking means…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Pedestrian crossing ahead' },
        { id: 'b', label: 'No pedestrians allowed' },
        { id: 'c', label: 'Bus stop ahead' },
        { id: 'd', label: 'School zone ends' },
      ],
      correctOptionId: 'a',
      explanation: 'Red-bordered triangles warn of a hazard ahead — here, a pedestrian crossing. Slow down.',
    },
    {
      id: 'rs2', prompt: 'A circular sign with a red border and "50" means…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Minimum speed 50 km/h' },
        { id: 'b', label: 'Maximum speed 50 km/h' },
        { id: 'c', label: 'Distance to next town 50 km' },
        { id: 'd', label: 'Recommended speed 50 km/h' },
      ],
      correctOptionId: 'b',
      explanation: 'A red-ring circular sign is a prohibition/limit — 50 is the maximum speed permitted.',
    },
    {
      id: 'rs3', prompt: 'An octagonal red sign means…', timeLimitSecs: 15,
      options: [
        { id: 'a', label: 'Yield' },
        { id: 'b', label: 'Stop' },
        { id: 'c', label: 'No entry' },
        { id: 'd', label: 'Roundabout' },
      ],
      correctOptionId: 'b',
      explanation: 'The octagon is universally STOP — come to a complete halt before proceeding.',
    },
    {
      id: 'rs4', prompt: 'A blue circular sign with a white arrow pointing up means…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Dead end ahead' },
        { id: 'b', label: 'One-way, straight ahead only' },
        { id: 'c', label: 'No overtaking' },
        { id: 'd', label: 'Parking ahead' },
      ],
      correctOptionId: 'b',
      explanation: 'Blue circular signs give a mandatory instruction — proceed straight ahead only.',
    },
    {
      id: 'rs5', prompt: 'A sign showing two children usually indicates…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Playground closed' },
        { id: 'b', label: 'School / children crossing — drive with care' },
        { id: 'c', label: 'No horns' },
        { id: 'd', label: 'Hospital ahead' },
      ],
      correctOptionId: 'b',
      explanation: 'Warns of a school or children crossing. Reduce speed and be ready to stop.',
    },
  ],
  'highway-code': [
    {
      id: 'hc1', prompt: 'At an unmarked junction of equal roads, you should give way to…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Traffic on your right' },
        { id: 'b', label: 'Traffic on your left' },
        { id: 'c', label: 'The larger vehicle' },
        { id: 'd', label: 'Nobody — you have priority' },
      ],
      correctOptionId: 'a',
      explanation: 'In Nigeria (drive-on-the-right), give way to traffic approaching from your right at equal junctions.',
    },
    {
      id: 'hc2', prompt: 'When is it safe to overtake?', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'On a bend where you cannot see ahead' },
        { id: 'b', label: 'When the road ahead is clear and markings permit' },
        { id: 'c', label: 'Approaching a pedestrian crossing' },
        { id: 'd', label: 'Just before a junction' },
      ],
      correctOptionId: 'b',
      explanation: 'Only overtake when you can see the road is clear and road markings allow it.',
    },
    {
      id: 'hc3', prompt: 'The safe following distance in good conditions is at least…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Half a second' },
        { id: 'b', label: 'One car length' },
        { id: 'c', label: 'A two-second gap' },
        { id: 'd', label: 'Whatever feels right' },
      ],
      correctOptionId: 'c',
      explanation: 'Keep at least a two-second gap so you have time to react and brake safely.',
    },
    {
      id: 'hc4', prompt: 'A flashing amber traffic light means…', timeLimitSecs: 15,
      options: [
        { id: 'a', label: 'Stop completely' },
        { id: 'b', label: 'Proceed with caution' },
        { id: 'c', label: 'Speed up to clear' },
        { id: 'd', label: 'The light is broken — ignore it' },
      ],
      correctOptionId: 'b',
      explanation: 'Flashing amber = slow down and proceed with caution, yielding as needed.',
    },
    {
      id: 'hc5', prompt: 'Before changing lanes you must…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Signal, check mirrors and blind spot, then move' },
        { id: 'b', label: 'Move quickly so others notice' },
        { id: 'c', label: 'Only signal if cars are close' },
        { id: 'd', label: 'Sound your horn' },
      ],
      correctOptionId: 'a',
      explanation: 'Mirror–signal–manoeuvre: signal, check mirrors and blind spot, then change lanes.',
    },
  ],
  safety: [
    {
      id: 'sf1', prompt: 'At a crash scene, your first priority is to…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Move casualties immediately' },
        { id: 'b', label: 'Make the scene safe and call for help' },
        { id: 'c', label: 'Take photos for insurance' },
        { id: 'd', label: 'Drive on to avoid delay' },
      ],
      correctOptionId: 'b',
      explanation: 'Protect the scene (hazard lights, warning triangle) and call emergency services before anything else.',
    },
    {
      id: 'sf2', prompt: 'For someone who is bleeding heavily, you should…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Apply firm direct pressure to the wound' },
        { id: 'b', label: 'Give them water to drink' },
        { id: 'c', label: 'Remove any embedded object' },
        { id: 'd', label: 'Wait for it to stop on its own' },
      ],
      correctOptionId: 'a',
      explanation: 'Direct, firm pressure on the wound helps control heavy bleeding until help arrives.',
    },
    {
      id: 'sf3', prompt: 'The safest thing to do if you feel drowsy while driving is…', timeLimitSecs: 15,
      options: [
        { id: 'a', label: 'Open the window and push on' },
        { id: 'b', label: 'Drink coffee and keep driving' },
        { id: 'c', label: 'Stop somewhere safe and rest' },
        { id: 'd', label: 'Drive faster to arrive sooner' },
      ],
      correctOptionId: 'c',
      explanation: 'Fatigue kills — pull over somewhere safe and rest. No trick keeps a tired driver alert.',
    },
    {
      id: 'sf4', prompt: 'Seatbelts should be worn by…', timeLimitSecs: 15,
      options: [
        { id: 'a', label: 'Only the driver' },
        { id: 'b', label: 'Only front-seat occupants' },
        { id: 'c', label: 'Every occupant, front and back' },
        { id: 'd', label: 'Only on the highway' },
      ],
      correctOptionId: 'c',
      explanation: 'Everyone in the vehicle must belt up — rear occupants are at risk too in a crash.',
    },
    {
      id: 'sf5', prompt: 'If your vehicle starts to skid, you should…', timeLimitSecs: 20,
      options: [
        { id: 'a', label: 'Brake hard immediately' },
        { id: 'b', label: 'Steer gently into the skid and ease off the accelerator' },
        { id: 'c', label: 'Turn sharply the other way' },
        { id: 'd', label: 'Accelerate to regain grip' },
      ],
      correctOptionId: 'b',
      explanation: 'Ease off the accelerator and steer gently in the direction of the skid to regain control.',
    },
  ],
};

export function mockPlayAlong(category: string): PlayAlongQuestion[] {
  return MOCK_PLAYALONG[category] ?? MOCK_PLAYALONG['road-signs'];
}
