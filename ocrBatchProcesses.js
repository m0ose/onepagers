import * as workQ from 'https://redfishgroup.github.io/firebase_worker_queue/src/queue.js'

/**
 * Claim the next next batch OCR task
 * @public
 * @param {Firebase ref} awfRef 
 */
export async function claimBatchVideoTask(awfRef) {
    const batchTasksRef = awfRef.child('ocr_batch_tasks')
    //https://acequia.firebaseio.com/awf_v0/ocr_batch_tasks
    // workQ.watchQueueAsync(batchTasksRef, async (task)=>{
    const task = await workQ.getTask(batchTasksRef, 'available')
    let ticket
    try {
        ticket = await workQ.claimTask(batchTasksRef, task, 'the dandilorian')
    } catch (err) {
        console.log(err)
        // failed to claim
        return
    }
    try {
        const ocrResult = await searchVideoURL(ticket.url, awfRef)
        await workQ.completeTask(batchTasksRef, ticket, ocrResult)
    } catch (err) {
        console.error(err)
        console.error('Failed on', ticket.url)
        await workQ.errorTask(batchTasksRef, ticket, err)
    }
}


/**
 * Monitor avaliable tasks for when nothing is happening and call the callback when it's idle.
 *
 * @public
 * @param {ref to queue} queueRef
 * @param {function} callback
 * @param {Number} minIdleTime - How long to wait for idle queue
 * @param {Boolean} watchActiveList - Call callback when active list is also empty. This is ooff by default
 */
export function monitorForIdle(
    queueRef,
    callback,
    minIdleTime = 60000,
    watchActiveList = false
) {
    let timeoutID = undefined
    function innerCallback(snap) {
        clearTimeout(timeoutID)
        timeoutID = undefined
        const count = snap.numChildren()
        if (count === 0) {
            timeoutID = setTimeout(callback, minIdleTime)
        }
    }
    queueRef.child('available').on('value', async (snap) => {
        innerCallback(snap)
    })
    if (watchActiveList) {
        queueRef.child('active').on('value', async (snap) => {
            innerCallback(snap)
        })
    }
}

/**
 * Search video url for changes in the orientation using OCR, and place results on firebase. 
 * @param {String} url - url of video to search
 * @param {*} awfRef - Firebase ref to place results in
 */
async function searchVideoURL(url, awfRef) {
    // db.ref().child('awf_v0')
    const ocrRef = awfRef.child('OCR_workerQueue')
    const mediaObjectsRef = awfRef.child('mediaObjects')
    const keyFramesObjRef = awfRef.child('keyframes')
    const ocrResults = await searchVideoRecursiveFunction(url, ocrRef)
    const keyframes = makeKeyframesFromOCRResults(ocrResults, url)
    const mediaObj = makeMediaObjsFromOCRResults(ocrResults, url)
    console.log({ ocrResults, keyframes, mediaObj })
    // update firebase
    keyframes.forEach(async (a) => {
        const myPath = `${convertNumberToFirebasePath(a.absoluteTime)}/${
            a.mediaObjectID
        }`
        if (myPath) {
            await keyFramesObjRef.child(myPath).update(a)
        } else {
            console.error('did not find guid!', a)
        }
    })
    if (mediaObj.guid) {
        await mediaObjectsRef.child(mediaObj.guid).update(mediaObj)
    } else {
        console.error('did not find guid!', mediaObj)
    }
    return { ocrResults, keyframes, mediaObj }
}

/**
 * 
 * @private
 * @param {Object} ocrResults 
 * @param {String} url 
 */
function makeKeyframesFromOCRResults(ocrResults, url) {
    const guid = makeFirebaseSafeKey(url)
    const keyFrames = ocrResults.map((a) => {
        const ktime = a.result.time
        return {
            PTZPose: a.result,
            absoluteTime: ktime,
            guid: ktime,
            mediaObjectID: guid,
        }
    })
    return keyFrames
}

/**
 * @private
 * @param {Object} ocrResults 
 * @param {String} url 
 */
function makeMediaObjsFromOCRResults(ocrResults, url) {
    const guid = makeFirebaseSafeKey(url)
    const keyFrameIDs = ocrResults
        .map((a) => a.result.time)
        .map(convertNumberToFirebasePath)
    const keyTimes = ocrResults.map((a) => a.result.time).sort()
    const minTime = keyTimes[0]
    const maxTime = keyTimes[keyTimes.length - 1]
    const aspectRatio = ocrResults[0].result.aspectRatio
    const result = {
        keyFrameIDs,
        calibratedTime: [minTime, maxTime],
        guid,
        aspectRatio,
    }
    return result
}

/**
 * 
 * @param {String} url 
 * @param {Firebase ref} mainOCRRef 
 * @param {Number} mediaTimeRatio - number from 0 to 1. 0 being the start and 1 being the end
 */
async function ocrASingleTime(url, mainOCRRef, mediaTimeRatio) {
    const taskTask = await workQ.addTask(mainOCRRef, {
        mediaObject: { src: url },
        mediaTimeSeconds: mediaTimeRatio,
        signed: 'alpha-bravo-niner',
    })
    console.log('Task Description:', taskTask)
    const a = await workQ.taskListenerPromise(mainOCRRef, taskTask)
    console.log('done with task', a)
    return a
}

/**
 * This is the work horse of the ocr search. 
 * @private
 * @param {String} url 
 * @param {Firebase ref} mainOCRRef 
 * @param {*} startResult 
 * @param {*} endResult 
 * @param {*} startMediaTime 
 * @param {*} endMediaTime 
 * @param {*} minTimeResolution 
 */
async function searchVideoRecursiveFunction(
    url,
    mainOCRRef,
    startResult,
    endResult,
    startMediaTime = 0.0,
    endMediaTime = 1.0,
    minTimeResolution = 0.01
) {
    if (
        startResult &&
        endResult &&
        !resultsChanged(startResult.result, endResult.result)
    ) {
        return [] // for efficiancy, dont calculate if not needed
    }
    const duration = endMediaTime - startMediaTime
    const middleTime = startMediaTime + duration / 2
    let myResults = []
    let startPromise, endPromise, midPromise
    let midResult
    // OCR start then end then middle
    //
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
    //

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
            const [rightResult, leftResult] = await Promise.all([
                leftPromise,
                rightPromise,
            ])

            myResults = myResults.concat(leftResult)
            myResults = myResults.concat(rightResult)
        }
    }

    return myResults
}

function resultsChanged(a, b) {
    return a.x != b.x || a.y != b.y || a.z != b.z
}

/**
 * This parses the UTC into a path of 2 digit chunks. 
 * @param {int} utc 
 */
function convertNumberToFirebasePath(utc) {
    const str = String(utc)
    const path = str.match(/.{1,2}/g).join('/')
    return path
}



function makeFirebaseSafeKey(key) {
    var key2 = String(key)
    var badChars = '.$[]#/ '
    for (var i of badChars) {
        key2 = key2.split(i).join('')
    }
    return key2
}
