import { queryClient } from "@/state/queryClient";

afterEach(() => {
    queryClient.clear();
});
