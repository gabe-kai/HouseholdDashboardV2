/** Fictional evaluation seed — no real household data. Applied by `npm run db:seed`. */
export const SEED = {
  household: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Evaluation Household",
  },
  members: [
    {
      id: "22222222-2222-4222-8222-222222222201",
      displayName: "Alex Parent",
      capabilities: ["manage_routine"] as const,
    },
    {
      id: "22222222-2222-4222-8222-222222222202",
      displayName: "Jamie Child",
      capabilities: ["execute_own_occurrence"] as const,
    },
    {
      id: "22222222-2222-4222-8222-222222222203",
      displayName: "Riley Child",
      capabilities: ["execute_own_occurrence"] as const,
    },
  ],
} as const;
