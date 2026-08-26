plugins {
    id("org.jetbrains.intellij.platform") version "2.4.0"
    kotlin("jvm") version "2.0.21"
}

group = "com.minio"
version = "0.1.0"

repositories { mavenCentral(); intellijPlatform { defaultRepositories() } }
dependencies { intellijPlatform { intellijIdeaCommunity("2024.3") } }
intellijPlatform { pluginConfiguration { ideaVersion { sinceBuild = "243" } } }
