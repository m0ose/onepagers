import * as workQ from 'https://redfishgroup.github.io/firebase_worker_queue/src/queue.js'

async function ocrASingleTime(url, mainOCRRef, mediaTimeSec) {
    // const mediaObjRef = awfRef.child('mediaObjects')
    // const keyFramesObjRef = awfRef.child('mediaObjects')
    console.log('c')
    //
    const taskTask = await workQ.addTask(mainOCRRef, {
        mediaObject: { src: url },
        mediaTimeSeconds: mediaTimeSec,
        signed: 'dumple-minkin-stein',
    })

    console.log('Task Description:', taskTask)
    const a = await workQ.taskListenerPromise(mainOCRRef, taskTask)
    console.log('done with task', a)
    return a
}

async function searchVideoRecursiveFunction(
    url,
    mainOCRRef,
    startResult,
    endResult,
    startMediaTime = 0.0,
    endMediaTime = 1.0,
    minTimeResolution = 0.01
) {
    console.log('panda 0', {startMediaTime, endMediaTime})
    if(startResult && endResult && !resultsChanged(startResult.result, endResult.result)){
        return [] // for efficiancy, dont calculate if not needed
    }
    const duration = endMediaTime - startMediaTime
    const middleTime = startMediaTime + duration / 2
    let myResults = []
    let startPromise, endPromise, midPromise
    let midResult
    // OCR start then end then middle
    if (!startResult) {
        startPromise = ocrASingleTime(url, mainOCRRef, startMediaTime)
    }
    if (!endResult) {
        endPromise = ocrASingleTime(url, mainOCRRef, endMediaTime)
    }
    midPromise = ocrASingleTime(url, mainOCRRef, middleTime)
    const fullfilled = await Promise.all([startPromise, endPromise, midPromise])
    if (fullfilled[0]) {
        startResult = fullfilled[0]
        myResults.push(startResult)
    }
    if (fullfilled[1]) {
        endResult = fullfilled[1]
        myResults.push(endResult)
    }
    midResult = fullfilled[2]
    myResults.push(midResult)
    console.log('panda 1', myResults)
    // check for change and if so recurse
    if (resultsChanged(startResult.result, endResult.result)) {
        if (duration / 2 > minTimeResolution) {
            const leftPromise = searchVideoRecursiveFunction(
                url,
                mainOCRRef,
                startResult,
                midResult,
                startMediaTime,
                middleTime
            )
            const rightPromise = searchVideoRecursiveFunction(
                url,
                mainOCRRef,
                midResult,
                endResult,
                middleTime,
                endMediaTime
            )
            const [rightResult, leftResult] = await Promise.all([leftPromise, rightPromise])
            console.log('panda 1b', {leftResult, rightResult})
            myResults = myResults.concat(leftResult)
            myResults = myResults.concat(rightResult)
        }
    }
    console.log("panda 2",myResults)
    return myResults
}

function resultsChanged(a, b) {
    return a.x != b.x || a.y != b.y || a.z != b.z
}

export async function searchViddeoURL(url, awfRef) {
    // db.ref().child('awf_v0')
    console.log('a')
    const ocrRef = awfRef.child('OCR_workerQueue')
    const mediaObjectsRef = awfRef.child('mediaObjects')
    const keyFramesObjRef = awfRef.child('mediaObjects')
    searchVideoRecursiveFunction(url, ocrRef)
}

function makeFirebaseSafeKey(key) {
    var key2 = String(key)
    var badChars = '.$[]#/ '
    for (var i of badChars) {
        key2 = key2.split(i).join('')
    }
    return key2
}

// pop urls
function populatTheVideoTasks(db) {
    getAllVideos(db.ref()).then(async (vals) => {
        console.log(vals)
        const anOKQueue = db.ref().child('awf_v0').child('ocr_batch_tasks')
        vals.forEach(async (url) => {
            console.log('url')
            const task = await workQ.addTask(anOKQueue, {
                url: url,
                signed: 'blobatron',
            })
            console.log('  ', task)
        })
    })
}

/**
 * Get video urls
 *
 * @param {ref to acequia} rootDB
 * @returns {String[]} allVidURLS
 */
export async function getAllVideos(rootDB) {
    const ref = rootDB.child('/alertwildfirebackup/firecams/videos')
    const snap = await ref.once('value')
    const val = snap.val()
    // gather all of the videos in the nested object list on firebase.
    function walkVideos(a) {
        let res = []
        for (const i in a) {
            if (typeof a[i] === 'object' && a[i] !== null) {
                const b = walkVideos(a[i])
                if (b) res = res.concat(b)
            } else if (i == 'url') {
                res.push(a[i])
            }
        }
        return res
    }

    const allVidURLS = walkVideos(val)
    return allVidURLS
}

async function getMediaObject(dbRef, url) {}

/**
 * Monitor avaliable tasks for nothing happening. Calls callback when nothing is happening.
 *
 * @param {ref to queue} queueRef
 * @param {function} callback
 * @param {Number} minIdleTime
 */
function monitorForIdle(queueRef, callback, minIdleTime = 15000) {
    let timeoutID = undefined
    queueRef.child('available').on('value', (snap) => {
        clearTimeout(timeoutID)
        timeoutID = undefined
        const count = snap.numChildren()
        if (count === 0) {
            timeoutID = setTimeout(callback, minIdleTime)
        }
    })
}

/* Randomize array in-place using Durstenfeld shuffle algorithm */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[array[i], array[j]] = [array[j], array[i]]
    }
}

// setTimeout(async () => {
//         console.log(await getAllVideos(db.ref()))
// }, 1000);

function searchWithOCR(
    media,
    startMediaTime,
    endMediaTime,
    startObj,
    endData
) {}
