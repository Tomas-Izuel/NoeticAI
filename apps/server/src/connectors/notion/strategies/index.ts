import type { NotionStrategy } from "./types";
import { dbSubjectsDbUnitsStrategy } from "./db-subjects-db-units";
import { singleDbTaggedStrategy } from "./single-db-tagged";
import { pageHierarchyStrategy } from "./page-hierarchy";
import { dbSubjectsPagesUnitsStrategy } from "./db-subjects-pages-units";
import { threeDbsStrategy } from "./three-dbs";

export {
  type NotionStrategy,
  type NotionClient,
  type SerializedField,
  type SerializedConfigSchema,
  type NotionPropertyType,
  type NotionDatabaseRef,
  type NotionPageRef,
  type NotionTopResourcesRich,
  type NotionIconRef,
  type PropertyDescriptor,
} from "./types";
export { dbSubjectsDbUnitsStrategy } from "./db-subjects-db-units";
export { singleDbTaggedStrategy } from "./single-db-tagged";
export { pageHierarchyStrategy } from "./page-hierarchy";
export { dbSubjectsPagesUnitsStrategy } from "./db-subjects-pages-units";
export { threeDbsStrategy } from "./three-dbs";

export const notionStrategies: Record<string, NotionStrategy> = {
  [dbSubjectsDbUnitsStrategy.key]: dbSubjectsDbUnitsStrategy,
  [singleDbTaggedStrategy.key]: singleDbTaggedStrategy,
  [pageHierarchyStrategy.key]: pageHierarchyStrategy,
  [dbSubjectsPagesUnitsStrategy.key]: dbSubjectsPagesUnitsStrategy,
  [threeDbsStrategy.key]: threeDbsStrategy,
};
