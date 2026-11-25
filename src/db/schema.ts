// Collects every module's tables so the typed query builder (getOrm) knows about them.
// Add one line per module as tables are created.
export * from "../modules/users/user.model.js";
export * from "../modules/auth/auth.model.js";
export * from "../modules/listings/listing.model.js";
export * from "../modules/jobs/job.model.js";
export * from "../modules/settings/setting.model.js";
export * from "../modules/vendors/vendor.model.js";
export * from "../modules/help/help.model.js";
export * from "../modules/email-templates/email-template.model.js";
