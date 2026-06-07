import { _setPersistDebounceMsForTest } from "@/state/debounceConfig";
import { queryClient, teardownPersister } from "@/state/queryClient";

beforeEach(() => {
    _setPersistDebounceMsForTest(0);
});

afterEach(() => {
    teardownPersister();
    queryClient.cancelQueries();
    queryClient.clear();
});
