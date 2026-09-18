// The former visual proving surface now serves the same authorized business galaxy.
export { default } from "../page";

// Next parses a route's segment config statically, so it cannot follow a re-export: `export {
// default, dynamic } from "../page"` fails the production build outright. Declared here instead,
// and it must stay identical to the `dynamic` in ../page.
export const dynamic = "force-dynamic";
