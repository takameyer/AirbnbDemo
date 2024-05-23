import { useApp, useUser } from "@realm/react";
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Text,
  TextInput,
  View,
  StyleSheet,
  Button,
  ListRenderItem,
} from "react-native";
import { useLocalQuery, useLocalRealm } from "./localRealm";
import { SearchCache } from "./localModels";
import { useSyncedQuery, useSyncedRealm } from "./syncedRealm";
import { ListingsAndReview } from "./syncedModels";
import FastImage from "react-native-fast-image";
import RNFS from "react-native-fs";

export const AirbnbList = () => {
  const [resultIds, setResultIds] = useState([]);
  const [error, setError] = useState("");
  const [offlineMode, setOfflineMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [cachedIds, setCachedIds] = useState(new Set());
  const [syncedDbSize, setSyncedDbSize] = useState(0);
  const [localDbSize, setLocalDbSize] = useState(0);
  const [cacheSize, setCacheSize] = useState(0);
  const localRealm = useLocalRealm();
  const syncedRealm = useSyncedRealm();
  const user = useUser();

  const cache = useLocalQuery(
    SearchCache,
    (col) => col.filtered("searchTerm == $0", searchTerm.toLowerCase()),
    [searchTerm]
  );

  const fullCache = useLocalQuery(SearchCache);

  const listings = useSyncedQuery(
    ListingsAndReview,
    (col) => col.filtered("_id in $0", resultIds),
    [resultIds]
  );

  const app = useApp();

  useEffect(() => {
    const allIds = fullCache.reduce((acc, cache) => {
      acc.push(...cache.results);
      return acc;
    }, []);
    const uniqueIds = [...new Set(allIds)];
    console.log("Updating subscription to: ", uniqueIds);
    syncedRealm
      .objects(ListingsAndReview)
      .filtered("_id in $0", [...new Set(uniqueIds)])
      .subscribe({ name: "listing" });
  }, [fullCache]);

  const doSearch = async () => {
    if (searchTerm !== "") {
      if (cache.length > 0) {
        console.log("Cache hit!: ", JSON.stringify(cache));
        const ids = cache[0].results.reduce((res, cur) => {
          res.push(cur);
          return res;
        }, []);
        setResultIds(ids);
      } else {
        console.log(searchTerm);
        const { result, error } = await user.functions.searchListings({
          searchPhrase: searchTerm,
          pageNumber: 1,
          pageSize: 20,
        });
        if (error) {
          console.error(error);
          setError(error);
        } else {
          console.log("got a result: ", result.length);

          const ids = result.map((item) => item._id);

          setResultIds(ids);

          console.log("subs: ", syncedRealm.subscriptions.length);

          localRealm.write(() => {
            localRealm.create(SearchCache, {
              searchTerm: searchTerm.toLowerCase(),
              results: ids,
            });
          });
          setError("");
        }
      }
    } else {
      setResultIds([]);
    }
  };

  useEffect(() => {
    getDatabaseSize();
    getCacheSize();
  }, [listings]);

  const getDatabaseSize = useCallback(async () => {
    const localDbFileInfo = await RNFS.stat(localRealm.path);
    const syncedDbFileInfo = await RNFS.stat(syncedRealm.path);
    setLocalDbSize(localDbFileInfo.size / (1024 * 1024));
    setSyncedDbSize(syncedDbFileInfo.size / (1024 * 1024));
  }, [listings]);

  const getCacheSize = useCallback(async () => {
    const cacheDir = `${RNFS.CachesDirectoryPath}/com.hackemist.SDImageCache/default`;
    const files = await RNFS.readDir(cacheDir);
    let totalSize = 0;
    for (const file of files) {
      const fileInfo = await RNFS.stat(file.path);
      totalSize += fileInfo.size;
    }
    const sizeInMB = totalSize / (1024 * 1024);
    setCacheSize(parseFloat(sizeInMB.toFixed(2))); // Round to 2 decimal places
  }, []);

  const clearCache = useCallback(async () => {
    await FastImage.clearMemoryCache();
    await FastImage.clearDiskCache();
    syncedRealm.subscriptions.update((mutableSubs) => {
      mutableSubs.removeAll();
    });
    // syncedRealm.write(() => {
    //   syncedRealm
    //     .objects(ListingsAndReview)
    //     .forEach((item) => [syncedRealm.delete(item)]);
    // });
    syncedRealm.write(() => {
      syncedRealm.deleteAll();
    });
    localRealm.write(() => {
      localRealm.deleteAll();
    });
    getDatabaseSize();
    getCacheSize();
    alert("Cache cleared!");
  }, []);

  useEffect(() => {
    offlineMode
      ? syncedRealm.syncSession.pause()
      : syncedRealm.syncSession.resume();
  }, [offlineMode]);

  const renderListing: ListRenderItem<ListingsAndReview> = useCallback(
    ({ item }) => (
      <View style={styles.listing}>
        <FastImage
          style={styles.image}
          source={{
            uri: item.images.picture_url,
            priority: FastImage.priority.normal,
            cache: FastImage.cacheControl.immutable,
          }}
        />
        <Text>{item.name}</Text>
      </View>
    ),
    []
  );

  return (
    <View style={styles.container}>
      <TextInput
        placeholder="Enter Search Term..."
        style={styles.searchInput}
        value={searchTerm}
        onChangeText={setSearchTerm}
      />
      <Button title="Do Search" onPress={doSearch} />
      <FlatList
        data={listings}
        renderItem={renderListing}
        keyExtractor={(item) => item.id}
      />
      <View style={styles.footer}>
        <Text>Local Database size: {localDbSize} mb</Text>
        <Text>Synced Database size: {syncedDbSize} mb</Text>
        <Text>Image Cache size: {cacheSize} mb</Text>
        <Button
          title={`${offlineMode ? "Disable" : "Enable"} Offline Mode`}
          onPress={() => setOfflineMode((prevOfflineMode) => !prevOfflineMode)}
        />
        <Button title="Clear Cache" onPress={clearCache} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listing: {
    flexDirection: "row",
    padding: 10,
    borderBottomWidth: 1,
    borderColor: "#ccc",
  },
  image: {
    width: 50,
    height: 50,
    marginRight: 10,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderColor: "#ccc",
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 23,
    paddingVertical: 12,
    paddingHorizontal: 6,
    margin: 6,
  },
});
