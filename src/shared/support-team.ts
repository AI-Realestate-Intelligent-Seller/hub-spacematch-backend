// Who agents can ask for help (was SUPPORT in convex/help.ts).
// Keep in sync with TEAM in frontend/src/lib/hub.ts (names, emails and topics shown in "Get help").
export const SUPPORT_TEAM: { name: string; email: string }[] = [
  { name: "Cris Castillo", email: "smm@spacematchinc.com" },
  { name: "Anthony “Atom” Arpia", email: "tc@spacematchinc.com" },
  { name: "Michael Kang", email: "michael@spacematchinc.com" },
  { name: "Brandon Banks", email: "brandon@spacematchinc.com" },
  { name: "Sergio Monjane", email: "sergio.monjane@spacematchinc.com" },
];

export const supportPerson = (email: string) => SUPPORT_TEAM.find(s => s.email === email.toLowerCase());
