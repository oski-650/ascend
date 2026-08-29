// Test setup — a DEPLOYMENT SETTING MUST NOT LEAK INTO UNIT TESTS.
//
// `ASCEND_PROSPECT_SOURCE=postgres` became the production setting when 2E flipped the reader. It
// lives in `.env.production.local`, and anyone who sources that file before running the suite —
// which is exactly what the database gates require — was handing it to every unit test in the
// process.
//
// The symptom was loud and correct: twenty vault-fixture tests failed with
// `ProspectSourceUnavailable`, because the reader was told to use Postgres and no connection was
// registered. That is the seam working as designed. It is still the wrong input: those tests build
// a temporary vault on disk and have nothing to do with the deployed store.
//
// So the variable is cleared before any test runs. A suite that genuinely needs a store sets it
// EXPLICITLY inside the test — which the parity and flip suites already do, and which makes the
// choice visible at the point it matters instead of inherited from whoever ran the command.

delete process.env.ASCEND_PROSPECT_SOURCE;
