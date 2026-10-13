/*
 * The rules' version. Client and server each run the rules (the client replays
 * the room's events on its own copy of the world), so they must run the same
 * ones: a client that connects with other rules is told to reload (Room, close
 * code 4002). test/version.test.ts fails whenever the rules' source changes
 * without RULES_VERSION going up, and says what RULES_HASH has become.
 */
export const RULES_VERSION = 17;
export const RULES_HASH = '8ab5b943fbad3519';
