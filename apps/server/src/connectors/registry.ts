import { createConnectorRegistry } from "@noeticai/connector-core";
import { stubConnector } from "./stub/connector";

export const connectorRegistry = createConnectorRegistry();

connectorRegistry.register(stubConnector);
