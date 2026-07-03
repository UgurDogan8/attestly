import Resolver from '@forge/resolver';
import { registerResolvers } from './resolvers';

const resolver = new Resolver();
registerResolvers(resolver);

export const handler = resolver.getDefinitions();
