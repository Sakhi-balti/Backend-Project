import { request } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError} from "../utils/ApiError.js";
import {User} from "../models/user.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken"

const generateAccessAndRefereshTokens = async(userId) =>
{
try {

  const user =  await User.findById(userId)
  const accessToken = user.generateAccessToken()
  const refereshToken = user.generateRefreshToken() 
  
  user.refereshToken = refereshToken
  await user.save({ validateBeforeSave: false })

  return {accessToken, refereshToken}

} catch (error) {
  throw new ApiError(500, "something went wrong while generating referesh and access token")
}

}


const registerUser = asyncHandler(async (req, res) => {
//  Get user details from frontend
// Validation -not empty
// check if user already exist: username , email
// check for images, check for avatar
// upload them to cloudinary, avatar
// create user object - create entry in db
// remove password and refresh token field from response

const {fullName, email, username, password }= req.body


if(
  [fullName, email, username, password].some((field) =>field?.trim() === "")
){
  throw new ApiError(400, "All fields are required")
}

const existedUser = await User.findOne({
  $or: [{username}, {email}]
})

if(existedUser){
  throw new ApiError(409, "User email or username already exists")
}

const avatarLocalPath = req.files?.avatar[0]?.path;
// const coverImageLocalPath = req.files?.coverImage[0]?.path;

let coverImageLocalPath;
if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0 ){
  coverImageLocalPath = req.files.coverImage[0].path
}

if(!avatarLocalPath){
  throw new ApiError(400, "Avatar file is required")
}
const avatar = await uploadOnCloudinary(avatarLocalPath)
const coverImage = await uploadOnCloudinary(coverImageLocalPath)

if(!avatar){
   throw new ApiError(400, "Failed to upload avatar")
}

const user = await User.create({
  fullName,
  avatar: avatar.url,
  coverImage: coverImage?.url || "",
  email,
  password,
  username: username.toLowerCase()
})

const createUser = await User.findById(user._id).select(
  "-password -refreshToken"
)
if(!createUser){
  throw new ApiError(500, "Something went wrong while registring the user")
}

return res.status(201).json(
  new ApiResponse(200, createUser, "User register successfully")
)
});


const loginUser = asyncHandler(async (req, res) => {
  // req body -> data
  // username or email
  // find the user
  // password check
  // access and refresh token
  // send cookie

  const { email, password, username } = req.body

  if (!username && !email) {
    throw new ApiError(400, "username or email is required")
  }

  const user = await User.findOne({
    $or: [{ username }, { email }]
  })

  if (!user) {
    throw new ApiError(404, "user does not exist")
  }

  const isPasswordValid = await user.isPasswordCorrect(password)

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials")
  }

  const { accessToken, refereshToken } = await generateAccessAndRefereshTokens(user._id)

  const loggedInUser = await User.findById(user._id).select("-password -refereshToken")

  const options = {
    httpOnly: true,
    secure: true
  }

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refereshToken", refereshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refereshToken
        },
        "User logged In successfully"
      )
    )
})

const logoutUser = asyncHandler(async(req, res) =>{
 
 await User.findByIdAndUpdate(
  req.user._id,
  {
    $set: {
      refereshToken: undefined
    }
  },
  {
    new: true
  }
 )
 const options = {
    httpOnly: true,
    secure: false
  }
  return res
  .status(200)
  .clearCookie("accessToken", options)
  .clearCookie("refereshToken", options)
  .json(new ApiResponse(200, {}, "User logout successfully"))
})


const refereshAcessToken = asyncHandler(async (req, res) => {
  const incomingRefereshToken = req.cookies.refereshToken || req.body.refereshToken

  if (!incomingRefereshToken) {
    throw new ApiError(401, "unauthorized request")
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefereshToken,
      process.env.REFRESH_TOKEN_SECRET
    )

    const user = await User.findById(decodedToken?._id)

    if (!user) {
      throw new ApiError(401, "Invalid refresh token")
    }

    if (incomingRefereshToken !== user?.refereshToken) {
      throw new ApiError(401, "refresh token is expired or used")
    }

    const options = {
      httpOnly: true,
      secure: true
    }

    const { accessToken, newRefereshToken } = await generateAccessAndRefereshTokens(user._id)

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refereshToken", newRefereshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refereshToken: newRefereshToken },
          "access token refreshed"
        )
      )
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token")
  }
})

const changeCurrentPassword = asyncHandler(async(req, res) =>{

  const {oldPassword, newPassword} = req.body

  const user = await User.findById(req.user?._id)
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)
  
  if(!isPasswordCorrect){
    throw new ApiError(400, "Invalid password")
  }

  user.password = newPassword
  await user.save({validateBeforeSave: false})

  return res
  .status(200)
  .json(new ApiResponse(200,{}, "Password changed successfully"))
})

const getCurrentUser = asyncHandler(async(req, res) =>{

  return res
  .status(200)
  .json(200, req.user, "current user fetched successfully")


})

const updateAccountDetails = asyncHandler(async(req, res) =>{

  const {fullName, email} = req.body

  if(!fullName || !email){
    throw new ApiError(400, "All fields are required")
  }

 const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set:{
        fullName,
        email
      }
    },
    {new: true}
  )
  .select("-password")
  return res
  .status(200)
  .json(new ApiResponse(200, user, "Account details updated successfully"))


})


const updateUserAvatar = asyncHandler(async(req, res) =>{

const avatarLocalPath = req.file?.path

if(!avatarLocalPath){
  throw new ApiError(400, "Avatar file is missing")
}

const avatar= await uploadOnCloudinary(avatarLocalPath)

if(!avatar.url){
  throw new ApiError(400, "Error while uploading on avatar")
}


const user = await User.findByIdAndUpdate(
  req.user?._id,
  {
    $set:{
      avatar: avatar.url
    }
  },
  {
    new: true
  }
).select("-password")

return res
.status(200)
.json(
  new ApiResponse(200, user, "avatar updated successfully" )
)

})


const updateUserCoverImage = asyncHandler(async(req, res) =>{

const coverImageLocalPath = req.file?.path

if(!coverImageLocalPath){
  throw new ApiError(400, "coverImage file is missing")
}

const coverImage = await uploadOnCloudinary(coverImageLocalPath)

if(!coverImage.url){
  throw new ApiError(400, "Error while uploading on coverImage")
}


const user = await User.findByIdAndUpdate(
  req.user?._id,
  {
    $set:{
      coverImage: coverImage.url
    }
  },
  {
    new: true
  }
).select("-password")

return res.
status(200)
.json(
  new ApiResponse(200,user, "coverImage updated successfully" )
)

})

export {
  registerUser,
  loginUser,
  logoutUser,
  refereshAcessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage
};
