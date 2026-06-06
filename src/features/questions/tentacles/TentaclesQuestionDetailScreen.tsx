import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme/colors";

export function TentaclesQuestionDetailScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>Not yet implemented</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: "center",
        paddingVertical: 32,
    },
    text: {
        color: colors.muted,
        fontSize: 15,
    },
});
