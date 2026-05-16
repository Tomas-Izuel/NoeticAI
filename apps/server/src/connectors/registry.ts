import { createConnectorRegistry } from "@noeticai/connector-core";
import { stubConnector } from "./stub/connector";
import { notionConnector } from "./notion/connector";

export const connectorRegistry = createConnectorRegistry();

connectorRegistry.register(stubConnector);
connectorRegistry.register(notionConnector);
